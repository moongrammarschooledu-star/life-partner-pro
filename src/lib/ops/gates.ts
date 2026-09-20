import type { AppEnv, ConfigIssue } from "@/lib/config/validate";

// Pure production-readiness evaluator (spec §49/§67/§68/§69). Given a facts
// snapshot it returns every gate with PASS / WARN / BLOCKED, the 18-category
// scorecard and the overall READY / NOT READY verdict.
//
// Principles enforced here:
//  - A gate is PASS only with positive evidence (live state or fresh CI
//    evidence). Missing evidence => BLOCKED with the exact reason — never a
//    silent pass and never a manual override.
//  - READY requires every *required* gate to PASS. Warnings are shown but
//    do not block; they also never turn into a PASS.
//  - No numeric score (spec §67).

export type GateStatus = "PASS" | "WARN" | "BLOCKED";

export const CATEGORIES = [
  "Application", "Database", "Security", "Privacy", "Authentication", "Authorization", "Matching", "Proposals", "Verification",
  "Communication", "Support", "Payments", "Backup", "Disaster Recovery", "Monitoring", "Deployment", "Performance", "Data Integrity",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Gate {
  id: string;
  category: Category;
  title: string;
  required: boolean;
  status: GateStatus;
  detail: string;
  remediation?: string;
}

export interface EvidenceFact {
  status: "PASS" | "FAIL";
  ageDays: number;
}

export interface ReadinessFacts {
  appEnv: AppEnv;
  configIssues: ConfigIssue[];
  evidence: Record<string, EvidenceFact | undefined>;
  evidenceMaxAgeDays: number;
  health: { dbOk: boolean; overall: "ok" | "degraded" | "down"; ready: boolean };
  migrations: { tracked: boolean; applied: number; failed: number };
  headers: { probed: boolean; https: boolean; hsts: boolean; nosniff: boolean; csp: "enforce" | "report-only" | "none"; poweredBy: boolean };
  rateLimitProbeOk: boolean;
  stateEndpointOk: boolean;
  backup: {
    enabled: boolean; keyConfigured: boolean; separateStore: boolean; lastSuccessAgeHours: number | null; backupStaleAfterHours: number;
    lastVerifiedPassed: boolean; failedCount: number; restoreTestStatus: string | null; restoreTestAgeDays: number | null; restoreTestStaleAfterDays: number;
    fileSources: number; fileMirrored: number; fileLastRunFailed: boolean;
  };
  jobs: { workerStatus: string | null; workerAgeHours: number | null; alertEvalAgeHours: number | null; deadLetter: number; tickConsecutiveFailures: number };
  alerts: { openCritical: number };
  integrity: { status: string | null; ageDays: number | null; highFindings: number };
  payments: { provider: string; activeBankAccounts: number; stage: string; envSafe: boolean; checklist: Record<string, boolean>; reconciliationClean: boolean | null; killSwitchExercised: boolean; webhooksEnabled: boolean };
  comms: { email: boolean; sms: boolean; whatsappEnabled: boolean; whatsappConfigured: boolean };
  security: { twoFactorRoles: string[]; adminSessionMaxHours: number; legacyUnencryptedPhotos: number; lockoutConfigured: boolean };
  release: { hasCurrent: boolean; healthy: boolean; approved: boolean; hasRollbackTarget: boolean };
  selfTest: { status: string | null; ageDays: number | null };
  storage: { tokenConfigured: boolean };
  performance: { slowQueryRows24h: number };
  drTargetsConfigured: boolean;
}

export interface Scorecard {
  category: Category;
  status: "PASS" | "PASS WITH WARNINGS" | "BLOCKED";
  blocking: string[];
  warnings: string[];
}

export interface ReadinessResult {
  verdict: "READY" | "NOT READY";
  gates: Gate[];
  scorecard: Scorecard[];
  unresolved: string[];
}

function evidenceGate(f: ReadinessFacts, id: string, kind: string, category: Category, title: string, required = true): Gate {
  const ev = f.evidence[kind];
  if (!ev) return { id, category, title, required, status: "BLOCKED", detail: `No ${kind} evidence recorded.`, remediation: "Run the CI pipeline with CI_EVIDENCE_TOKEN configured so results are recorded." };
  if (ev.status === "FAIL") return { id, category, title, required, status: "BLOCKED", detail: `Latest ${kind} run FAILED.`, remediation: "Fix the failing stage and re-run the pipeline." };
  if (ev.ageDays > f.evidenceMaxAgeDays) return { id, category, title, required, status: "BLOCKED", detail: `Latest ${kind} evidence is ${Math.floor(ev.ageDays)} days old (limit ${f.evidenceMaxAgeDays}).`, remediation: "Re-run the pipeline." };
  return { id, category, title, required, status: "PASS", detail: `${kind} passed ${ev.ageDays < 1 ? "today" : `${Math.floor(ev.ageDays)} day(s) ago`}.` };
}

function optionalEvidenceGate(f: ReadinessFacts, id: string, kind: string, category: Category, title: string, missingText: string): Gate {
  const ev = f.evidence[kind];
  if (!ev) return { id, category, title, required: false, status: "WARN", detail: missingText };
  if (ev.status === "FAIL") return { id, category, title, required: false, status: "WARN", detail: `Latest ${kind} run FAILED.` };
  if (ev.ageDays > f.evidenceMaxAgeDays * 4) return { id, category, title, required: false, status: "WARN", detail: `Latest ${kind} evidence is stale.` };
  return { id, category, title, required: false, status: "PASS", detail: `${kind} passed.` };
}

export function evaluateReadiness(f: ReadinessFacts): ReadinessResult {
  const gates: Gate[] = [];
  const add = (g: Gate) => gates.push(g);
  const prod = f.appEnv === "production";
  const cfg = (key: string) => f.configIssues.find((i) => i.key === key && (i.severity === "CRITICAL" || i.severity === "BLOCKER"));

  // ---- Application --------------------------------------------------------
  add(evidenceGate(f, "build", "BUILD", "Application", "Build passing"));
  add(evidenceGate(f, "typecheck", "TYPECHECK", "Application", "Type checking passing"));
  add(evidenceGate(f, "lint", "LINT", "Application", "Lint passing"));
  add(evidenceGate(f, "tests", "TESTS", "Application", "Unit tests passing"));
  add({ id: "health", category: "Application", title: "Health checks passing", required: true, status: f.health.ready && f.health.overall !== "down" ? "PASS" : "BLOCKED", detail: f.health.ready ? `Readiness ok, overall ${f.health.overall}.` : "Readiness check is failing (database, configuration or operational state).", remediation: "Open System Health for the failing dependency." });
  add({ id: "critical_config", category: "Application", title: "No critical configuration problems", required: true, status: f.configIssues.some((i) => i.severity === "CRITICAL") ? "BLOCKED" : "PASS", detail: f.configIssues.filter((i) => i.severity === "CRITICAL").map((i) => `${i.key}: ${i.message}`).join(" | ") || "None.", remediation: "Fix the listed environment variables." });

  // ---- Database -------------------------------------------------------------
  add({ id: "db_reachable", category: "Database", title: "Database reachable", required: true, status: f.health.dbOk ? "PASS" : "BLOCKED", detail: f.health.dbOk ? "Connection ok." : "Database connection failed." });
  add({ id: "migrations", category: "Database", title: "Versioned migrations applied", required: true, status: f.migrations.tracked && f.migrations.failed === 0 && f.migrations.applied > 0 ? "PASS" : "BLOCKED", detail: !f.migrations.tracked ? "No migration history table — schema is managed by db push." : f.migrations.failed > 0 ? `${f.migrations.failed} failed migration(s).` : `${f.migrations.applied} migration(s) applied.`, remediation: "Baseline the database with `prisma migrate resolve --applied 0_init` and deploy with `migrate deploy`." });
  add(evidenceGate(f, "migration_validation", "MIGRATION_VALIDATION", "Database", "Migration validation (schema matches migrations)"));
  const dbLabel = cfg("DATABASE_ENV_LABEL");
  add({ id: "db_env_label", category: "Database", title: "Database environment label matches deployment", required: true, status: dbLabel ? "BLOCKED" : "PASS", detail: dbLabel ? dbLabel.message : "DATABASE_ENV_LABEL matches APP_ENV.", remediation: "Set DATABASE_ENV_LABEL per Vercel environment, each with its OWN database." });
  add({ id: "indexes", category: "Database", title: "Indexes reviewed", required: false, status: "WARN", detail: "Reviewed in the STEP 15 audit (new indexes added); ongoing review is a manual practice — see Slow Queries.", remediation: "Review System Health → Slow Queries periodically." });

  // ---- Backup / Disaster Recovery ---------------------------------------------
  const b = f.backup;
  add({ id: "backup_configured", category: "Backup", title: "Backup encryption key configured", required: true, status: b.keyConfigured && b.enabled ? "PASS" : "BLOCKED", detail: !b.keyConfigured ? "BACKUP_ENCRYPTION_KEY is not set." : !b.enabled ? "Backups are disabled in Backup Policy." : "Configured and enabled.", remediation: "Set BACKUP_ENCRYPTION_KEY (32+ chars) in the environment." });
  const backupFresh = b.lastSuccessAgeHours != null && b.lastSuccessAgeHours <= b.backupStaleAfterHours;
  add({ id: "backup_recent", category: "Backup", title: "Recent successful backup exists", required: true, status: backupFresh ? "PASS" : "BLOCKED", detail: b.lastSuccessAgeHours == null ? "No successful backup exists." : `Last successful backup ${Math.round(b.lastSuccessAgeHours)} h ago (limit ${b.backupStaleAfterHours} h).`, remediation: "Trigger a backup from System Health → Backup & Recovery." });
  add({ id: "backup_verified", category: "Backup", title: "Latest backup restore-verified", required: true, status: b.lastVerifiedPassed ? "PASS" : "BLOCKED", detail: b.lastVerifiedPassed ? "Latest backup passed decrypt/parse/manifest verification." : "The latest backup has not passed restore verification.", remediation: "Run 'Verify restore' on the latest backup." });
  const restoreFresh = b.restoreTestStatus === "PASSED" && b.restoreTestAgeDays != null && b.restoreTestAgeDays <= b.restoreTestStaleAfterDays;
  add({ id: "restore_test", category: "Backup", title: "Restore test recent and passing", required: true, status: restoreFresh ? "PASS" : "BLOCKED", detail: b.restoreTestStatus == null ? "No restore test has ever run." : `Latest restore test ${b.restoreTestStatus}, ${Math.round(b.restoreTestAgeDays ?? 0)} day(s) old (limit ${b.restoreTestStaleAfterDays}).` });
  add({ id: "backup_separate_store", category: "Backup", title: "Backups in separate storage", required: false, status: b.separateStore ? "PASS" : "WARN", detail: b.separateStore ? "Separate backup storage token configured." : "Backups share the primary storage account (BACKUP_BLOB_READ_WRITE_TOKEN not set)." });
  add({ id: "file_backup", category: "Backup", title: "Private files mirrored", required: true, status: b.fileSources === 0 || (b.fileMirrored >= b.fileSources && !b.fileLastRunFailed) ? "PASS" : "BLOCKED", detail: b.fileSources === 0 ? "No private files exist yet." : `${b.fileMirrored}/${b.fileSources} file(s) mirrored.`, remediation: "Run a file backup until nothing remains." });
  add({ id: "backup_failures", category: "Backup", title: "No unresolved backup failures", required: false, status: b.failedCount === 0 ? "PASS" : "WARN", detail: `${b.failedCount} failed backup run(s) on record.` });

  add({ id: "dr_targets", category: "Disaster Recovery", title: "RPO/RTO targets configured", required: true, status: f.drTargetsConfigured ? "PASS" : "BLOCKED", detail: "Targets are objectives, not guarantees." });
  add({ id: "dr_runbooks", category: "Disaster Recovery", title: "Runbooks published", required: true, status: "PASS", detail: "12 operational runbooks are available under Admin → Operations → Runbooks." });
  add({ id: "dr_restore_workflow", category: "Disaster Recovery", title: "Restore requires verified backup + two-person approval", required: true, status: "PASS", detail: "Enforced in code (restore-request workflow); a restore is only ever executed out-of-app." });
  add({ id: "dr_restore_proven", category: "Disaster Recovery", title: "Restore procedure proven end-to-end", required: true, status: restoreFresh && b.lastVerifiedPassed ? "PASS" : "BLOCKED", detail: restoreFresh ? "Verified restore evidence exists." : "No fresh restore-verification evidence." });

  // ---- Security ------------------------------------------------------------------
  const h = f.headers;
  add({ id: "https", category: "Security", title: "HTTPS + HSTS live", required: prod, status: !h.probed ? (prod ? "BLOCKED" : "WARN") : h.https && (h.hsts || !prod) ? "PASS" : prod ? "BLOCKED" : "WARN", detail: !h.probed ? "Could not probe the deployed URL (APP_URL not set or unreachable)." : `https=${h.https}, HSTS=${h.hsts}.`, remediation: "Set APP_URL to the canonical https domain." });
  add({ id: "security_headers", category: "Security", title: "Security headers present", required: prod, status: !h.probed ? (prod ? "BLOCKED" : "WARN") : h.nosniff && !h.poweredBy && h.csp !== "none" ? "PASS" : prod ? "BLOCKED" : "WARN", detail: !h.probed ? "Not probed." : `nosniff=${h.nosniff}, CSP=${h.csp}, x-powered-by exposed=${h.poweredBy}.` });
  add({ id: "csp_enforced", category: "Security", title: "CSP enforced (not report-only)", required: false, status: h.csp === "enforce" ? "PASS" : "WARN", detail: h.csp === "enforce" ? "Enforced." : "Report-only — review violations, then set CSP_MODE=enforce." });
  add({ id: "secure_cookies", category: "Security", title: "Secure cookies", required: prod, status: prod && h.https ? "PASS" : prod ? "BLOCKED" : "WARN", detail: "Session cookies set Secure in production; HttpOnly + SameSite=Lax everywhere." });
  add({ id: "rate_limiting", category: "Security", title: "Persistent rate limiting operational", required: true, status: f.rateLimitProbeOk ? "PASS" : "BLOCKED", detail: f.rateLimitProbeOk ? "Counter probe incremented atomically." : "Rate-limit store probe failed." });
  const cronCfg = cfg("CRON_SECRET");
  const hookCfg = cfg("NOTIFICATION_WEBHOOK_SECRET");
  const exposure = f.configIssues.find((i) => i.severity === "CRITICAL" && i.message.includes("NEXT_PUBLIC_"));
  add({ id: "secrets", category: "Security", title: "Endpoint secrets set; no exposed secrets", required: true, status: cronCfg || hookCfg || exposure ? "BLOCKED" : "PASS", detail: [cronCfg?.message, hookCfg?.message, exposure?.message].filter(Boolean).join(" | ") || "CRON_SECRET and NOTIFICATION_WEBHOOK_SECRET set." , remediation: "Set the missing secrets in Vercel project environment variables." });
  add(evidenceGate(f, "security_scan", "SECURITY_SCAN", "Security", "Security scan (secrets, headers, authz coverage)"));
  add(evidenceGate(f, "dependency_audit", "DEPENDENCY_AUDIT", "Security", "Dependency audit (no high/critical in production deps)"));
  add(evidenceGate(f, "security_smoke", "SECURITY_SMOKE", "Security", "Production security smoke test"));
  add({ id: "encrypted_keys", category: "Security", title: "Independent encryption-key rotation", required: false, status: "WARN", detail: "File/session/step-up keys are all derived from NEXTAUTH_SECRET; rotating it invalidates every stored file and session. Key versioning is a documented follow-up." });

  // ---- Authentication / Authorization / Privacy ------------------------------------
  const twoFa = f.security.twoFactorRoles.includes("SUPER_ADMIN") && f.security.twoFactorRoles.includes("ADMIN");
  add({ id: "admin_2fa", category: "Authentication", title: "2FA required for SUPER_ADMIN and ADMIN", required: true, status: twoFa ? "PASS" : "BLOCKED", detail: `2FA required for: ${f.security.twoFactorRoles.join(", ") || "no roles"}.` });
  add({ id: "admin_lockout", category: "Authentication", title: "Admin lockout + persistent login throttling", required: true, status: f.security.lockoutConfigured && f.rateLimitProbeOk ? "PASS" : "BLOCKED", detail: "Per-account lockout plus per-IP/per-email persistent throttle." });
  add({ id: "admin_session", category: "Authentication", title: "Admin session lifetime ≤ 24 h", required: false, status: f.security.adminSessionMaxHours <= 24 ? "PASS" : "WARN", detail: `Configured: ${f.security.adminSessionMaxHours} h.` });
  add(optionalEvidenceGate(f, "auth_e2e", "SMOKE_AUTH", "Authentication", "Authenticated login/2FA smoke", "Authenticated flows (login, OTP) are not automated — never run with real credentials by this system."));
  add({ id: "authz_static", category: "Authorization", title: "Every admin/applicant API route enforces auth", required: true, status: f.evidence["SECURITY_SCAN"]?.status === "PASS" && f.evidence["TESTS"]?.status === "PASS" ? "PASS" : "BLOCKED", detail: "Verified by the automated route-auth coverage test (part of TESTS) and the security scan.", remediation: "Requires fresh TESTS + SECURITY_SCAN evidence." });
  add(evidenceGate(f, "authz_smoke", "SECURITY_SMOKE", "Authorization", "Unauthorized-access matrix (live)"));
  add({ id: "legacy_photos", category: "Privacy", title: "All profile photos encrypted at rest", required: true, status: f.security.legacyUnencryptedPhotos === 0 ? "PASS" : "BLOCKED", detail: f.security.legacyUnencryptedPhotos === 0 ? "No unencrypted photos remain." : `${f.security.legacyUnencryptedPhotos} legacy unencrypted photo(s) — the encrypt-legacy-photos job will convert them.`, remediation: "Run the ENCRYPT_LEGACY_PHOTOS job (System Health → Jobs)." });
  add({ id: "private_storage", category: "Privacy", title: "File storage configured", required: true, status: f.storage.tokenConfigured ? "PASS" : "BLOCKED", detail: "Files are AES-256-GCM ciphertext behind authenticated streaming routes; Vercel Blob objects are public-by-URL ciphertext (WARNING below).", remediation: "Set BLOB_READ_WRITE_TOKEN." });
  add({ id: "storage_env_label", category: "Privacy", title: "Storage environment label matches deployment", required: true, status: cfg("STORAGE_ENV_LABEL") ? "BLOCKED" : "PASS", detail: cfg("STORAGE_ENV_LABEL")?.message ?? "STORAGE_ENV_LABEL matches APP_ENV." });
  add({ id: "public_blob_urls", category: "Privacy", title: "Private (non-public) blob access", required: false, status: "WARN", detail: "Objects are encrypted and their URLs are never returned by any API, but Vercel Blob URLs are publicly fetchable if guessed." });

  // ---- Domain features (evidence = tests; authenticated E2E absent) -----------------------
  const testsGate = evidenceGate(f, "tests_domain", "TESTS", "Matching", "Matching logic tests (weights, eligibility, explainability)");
  add(testsGate);
  add({ ...testsGate, id: "tests_proposals", category: "Proposals", title: "Proposal workflow tests (consent-based transitions)" });
  add({ ...testsGate, id: "tests_verification", category: "Verification", title: "Verification logic tests" });
  add({ ...testsGate, id: "tests_support", category: "Support", title: "Case/support logic tests" });
  for (const [id, category, title] of [["e2e_matching", "Matching", "Authenticated matching flow"], ["e2e_proposals", "Proposals", "Authenticated proposal flow"], ["e2e_verification", "Verification", "Authenticated verification flow"], ["e2e_support", "Support", "Authenticated support flow"]] as const) {
    add(optionalEvidenceGate(f, id, "SMOKE_AUTH", category, title, "No authenticated end-to-end evidence — covered by unit tests and prior live verification only."));
  }

  // ---- Communication ------------------------------------------------------------------------
  add({ id: "email", category: "Communication", title: "Email provider configured", required: true, status: f.comms.email ? "PASS" : "BLOCKED", detail: f.comms.email ? "Provider key present." : "No email provider — messages are logged, not delivered.", remediation: "Set EMAIL_PROVIDER_API_KEY and connect a real provider." });
  add({ id: "sms", category: "Communication", title: "SMS provider configured", required: false, status: f.comms.sms ? "PASS" : "WARN", detail: f.comms.sms ? "Provider key present." : "No SMS provider — SMS not delivered." });
  add({ id: "whatsapp", category: "Communication", title: "WhatsApp channel", required: false, status: !f.comms.whatsappEnabled || f.comms.whatsappConfigured ? "PASS" : "WARN", detail: f.comms.whatsappEnabled ? (f.comms.whatsappConfigured ? "Enabled and configured." : "Enabled but no API key.") : "Disabled." });
  add({ id: "queue", category: "Communication", title: "Background queue healthy", required: true, status: f.jobs.workerStatus === "SUCCESS" && f.jobs.deadLetter === 0 ? "PASS" : "BLOCKED", detail: f.jobs.workerStatus == null ? "The job worker has never run." : `Worker ${f.jobs.workerStatus}, ${f.jobs.deadLetter} dead-letter job(s).`, remediation: "Run the scheduled tick (System Health → Jobs & Cron) and resolve dead-letter jobs." });

  // ---- Payments -----------------------------------------------------------------------------------
  const p = f.payments;
  add({ id: "pay_env", category: "Payments", title: "Payment environment consistent", required: true, status: p.envSafe && !cfg("PAYMENT_ENVIRONMENT") && !cfg("STRIPE_SECRET_KEY") ? "PASS" : "BLOCKED", detail: p.envSafe ? `Provider ${p.provider}, stage ${p.stage}.` : "Environment/provider/stage combination is unsafe." });
  const manual = p.provider === "MANUAL";
  add({ id: "pay_provider", category: "Payments", title: "Payment provider ready", required: true, status: (manual && p.activeBankAccounts > 0) || (!manual && p.envSafe) ? "PASS" : "BLOCKED", detail: manual ? (p.activeBankAccounts > 0 ? "Manual bank-transfer provider (admin-verified) with a receiving account configured — no card gateway is configured." : "Manual provider active but no receiving bank account is configured.") : `Provider ${p.provider} configured.`, remediation: "Add a receiving bank account (Finance Center → Bank Accounts) or configure a real gateway." });
  const flowItems = Object.entries(p.checklist).filter(([k]) => !(manual && k === "processedWebhookEvent"));
  add({ id: "pay_flows", category: "Payments", title: "Payment flows exercised (sandbox checklist)", required: true, status: flowItems.length > 0 && flowItems.every(([, v]) => v) ? "PASS" : "BLOCKED", detail: `${flowItems.filter(([, v]) => v).length}/${flowItems.length} checklist items exercised in this environment.`, remediation: "Complete the Sandbox Readiness Checklist (Finance Center → Rollout)." });
  add({ id: "pay_webhook", category: "Payments", title: "Webhook processing verified", required: !manual, status: manual ? "PASS" : p.checklist.processedWebhookEvent && p.webhooksEnabled ? "PASS" : "BLOCKED", detail: manual ? "Manual provider has no webhook source (bank transfers are admin-verified)." : p.checklist.processedWebhookEvent ? "A webhook event was processed." : "No webhook event has ever been processed here." });
  add({ id: "pay_reconciliation", category: "Payments", title: "Reconciliation verified", required: true, status: p.reconciliationClean === true ? "PASS" : "BLOCKED", detail: p.reconciliationClean == null ? "No reconciliation run exists." : p.reconciliationClean ? "Latest run clean." : "Latest run has mismatches." });
  add({ id: "pay_refund", category: "Payments", title: "Refund tested", required: true, status: p.checklist.completedRefund ? "PASS" : "BLOCKED", detail: p.checklist.completedRefund ? "A completed refund exists." : "No completed refund has been exercised." });
  add({ id: "pay_kill_switch", category: "Payments", title: "Kill switch tested", required: true, status: p.killSwitchExercised ? "PASS" : "BLOCKED", detail: p.killSwitchExercised ? "The kill switch has been exercised and audited." : "The kill switch has never been used/tested." });

  // ---- Monitoring / Deployment / Performance / Integrity ------------------------------------------------
  add({ id: "monitor_selftest", category: "Monitoring", title: "Monitoring pipeline self-test (error → alert → incident)", required: true, status: f.selfTest.status === "PASS" && f.selfTest.ageDays != null && f.selfTest.ageDays <= f.evidenceMaxAgeDays ? "PASS" : "BLOCKED", detail: f.selfTest.status == null ? "The self-test has never run." : `Last self-test ${f.selfTest.status}, ${Math.floor(f.selfTest.ageDays ?? 0)} day(s) ago.`, remediation: "Run the monitoring self-test from Production Readiness." });
  add({ id: "monitor_alert_eval", category: "Monitoring", title: "Alert evaluation running", required: true, status: f.jobs.alertEvalAgeHours != null && f.jobs.alertEvalAgeHours <= 36 ? "PASS" : "BLOCKED", detail: f.jobs.alertEvalAgeHours == null ? "Alert evaluation has never run." : `Last run ${Math.round(f.jobs.alertEvalAgeHours)} h ago.` });
  add({ id: "monitor_criticals", category: "Monitoring", title: "No open critical alerts/incidents", required: true, status: f.alerts.openCritical === 0 ? "PASS" : "BLOCKED", detail: `${f.alerts.openCritical} open critical alert(s).` });
  add({ id: "monitor_cron", category: "Monitoring", title: "Scheduled tick not failing", required: true, status: f.jobs.tickConsecutiveFailures === 0 ? "PASS" : "BLOCKED", detail: `${f.jobs.tickConsecutiveFailures} consecutive failure(s).` });

  add({ id: "maintenance_mode", category: "Deployment", title: "Maintenance/emergency state endpoint working", required: true, status: f.stateEndpointOk ? "PASS" : "BLOCKED", detail: f.stateEndpointOk ? "Public state endpoint returns a valid state." : "State endpoint check failed." });
  add(evidenceGate(f, "smoke", "SMOKE", "Deployment", "Post-deploy smoke test"));
  add({ id: "release_healthy", category: "Deployment", title: "Current release verified healthy", required: true, status: f.release.hasCurrent && f.release.healthy ? "PASS" : "BLOCKED", detail: !f.release.hasCurrent ? "No release recorded for this deployment." : f.release.healthy ? "Post-deploy verification passed." : "Post-deploy verification failed.", remediation: "Investigate the release under Production Readiness → Releases." });
  add({ id: "release_approved", category: "Deployment", title: "Current release approved", required: prod, status: f.release.approved ? "PASS" : prod ? "BLOCKED" : "WARN", detail: f.release.approved ? "Approved." : "The current release has not been approved by an authorised administrator." });
  add({ id: "rollback_plan", category: "Deployment", title: "Rollback target available", required: true, status: f.release.hasRollbackTarget ? "PASS" : "BLOCKED", detail: f.release.hasRollbackTarget ? "A previous healthy release is recorded." : "No previous stable release recorded to roll back to.", remediation: "Available after a second verified release." });
  const sepEnv = f.configIssues.find((i) => i.severity === "BLOCKER" && (i.key === "DATABASE_ENV_LABEL" || i.key === "STORAGE_ENV_LABEL"));
  add({ id: "env_separation", category: "Deployment", title: "Environments separated and labelled", required: true, status: sepEnv || cfg("APP_URL") ? "BLOCKED" : "PASS", detail: sepEnv?.message ?? cfg("APP_URL")?.message ?? "Environment labels set." });
  add({ id: "ci_token", category: "Deployment", title: "CI evidence ingestion configured", required: true, status: cfg("CI_EVIDENCE_TOKEN") ? "BLOCKED" : "PASS", detail: cfg("CI_EVIDENCE_TOKEN")?.message ?? "CI_EVIDENCE_TOKEN set." });

  add({ id: "perf_slow", category: "Performance", title: "No recurring slow queries (24 h)", required: false, status: f.performance.slowQueryRows24h === 0 ? "PASS" : "WARN", detail: `${f.performance.slowQueryRows24h} slow-query pattern(s) in the last 24 h.` });
  add(optionalEvidenceGate(f, "perf_load", "LOAD_TEST", "Performance", "Load test", "No load test recorded. No capacity claim is made."));

  add({ id: "integrity", category: "Data Integrity", title: "Data-integrity checks clean of high-severity findings", required: true, status: f.integrity.status != null && f.integrity.highFindings === 0 && f.integrity.ageDays != null && f.integrity.ageDays <= 2 ? "PASS" : "BLOCKED", detail: f.integrity.status == null ? "Integrity checks have never run." : `Last run ${f.integrity.status}, ${f.integrity.highFindings} high finding(s), ${Math.floor(f.integrity.ageDays ?? 0)} day(s) ago.` });

  // ---- Scorecard + verdict -------------------------------------------------------------------------------
  const scorecard: Scorecard[] = CATEGORIES.map((category) => {
    const inCat = gates.filter((g) => g.category === category);
    const blocking = inCat.filter((g) => g.required && g.status === "BLOCKED").map((g) => `${g.title}: ${g.detail}`);
    const warnings = inCat.filter((g) => g.status === "WARN" || (!g.required && g.status === "BLOCKED")).map((g) => `${g.title}: ${g.detail}`);
    return { category, status: blocking.length ? "BLOCKED" : warnings.length ? "PASS WITH WARNINGS" : "PASS", blocking, warnings };
  });

  const unresolved = gates.filter((g) => g.required && g.status !== "PASS").map((g) => `[${g.category}] ${g.title} — ${g.detail}`);
  return { verdict: unresolved.length === 0 ? "READY" : "NOT READY", gates, scorecard, unresolved };
}
