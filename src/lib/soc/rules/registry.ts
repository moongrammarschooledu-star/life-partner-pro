import type { RuleConfig, RuleDefinition, RuleQuery } from "@/lib/soc/types";

// STEP 32 — the detection rule catalog. Definitions live HERE (what a rule reads and what it means); tunable values (threshold, window,
// severity, enabled) live in versioned database rows, so a version can never change what a rule is about. Titles are neutral by design: a
// rule says "suspicious activity detected" or "attention needed" — it never says a person is a fraudster, an attacker or a criminal.
// Thresholds are starting points chosen to be quiet on a small team; they are meant to be tuned (with a reason) against dry-run results.

function events(
  key: string, name: string, category: string, description: string, title: string, unit: string,
  query: Extract<RuleQuery, { kind: "events" }>, defaults: RuleConfig, protectedRule = false,
): RuleDefinition {
  const tables = ["SecurityEvent"];
  return { key, name, category, description, source: tables.join(" + "), title, unit, query, defaults, protectedRule };
}
const cfg = (severity: RuleConfig["severity"], threshold: number, windowMinutes: number, enabled = true): RuleConfig => ({ enabled, severity, threshold, windowMinutes });

export const RULES: RuleDefinition[] = [
  // ---- authentication ----
  events("auth.failed_logins", "Repeated failed sign-ins", "AUTHENTICATION_ATTACK", "Many failed sign-ins against the same account within a short window.", "Suspicious activity detected: repeated failed sign-ins", "failed sign-ins",
    { kind: "events", types: ["LOGIN_FAILED"], groupBy: "subjectKey" }, cfg("MEDIUM", 8, 30)),
  events("auth.credential_stuffing", "Many accounts tried from one network", "AUTHENTICATION_ATTACK", "Failed sign-ins against many different accounts from the same network address (a pattern consistent with credential stuffing).", "Suspicious activity detected: many accounts tried from one network", "distinct accounts",
    { kind: "events", types: ["LOGIN_FAILED"], groupBy: "ipHash", distinctBy: "subjectKey" }, cfg("HIGH", 6, 60), true),
  events("auth.otp_failures", "Repeated one-time-code failures", "AUTHENTICATION_ATTACK", "Repeated wrong one-time codes for the same account.", "Suspicious activity detected: repeated one-time-code failures", "failed codes",
    { kind: "events", types: ["OTP_FAILED"], groupBy: "subjectKey" }, cfg("MEDIUM", 5, 30)),
  // ---- administrators ----
  events("admin.sensitive_access_burst", "Burst of sensitive admin access", "ACCOUNT_COMPROMISE", "An administrator opened an unusually large number of sensitive records in a short window.", "Suspicious activity detected: burst of sensitive access by one administrator", "sensitive accesses",
    { kind: "events", types: ["ADMIN_SENSITIVE_ACCESS"], groupBy: "adminId" }, cfg("MEDIUM", 40, 60)),
  events("admin.new_device_logins", "Sign-ins from several new devices", "ACCOUNT_COMPROMISE", "An administrator account signed in from several new devices in a day.", "Attention needed: several new devices for one administrator account", "new-device sign-ins",
    { kind: "events", types: ["NEW_DEVICE_SESSION"], groupBy: "adminId" }, cfg("LOW", 3, 1440)),
  events("admin.privilege_changes", "Unusual number of privilege changes", "AUTHORIZATION_FAILURE", "Roles or permissions were changed unusually often by the same administrator.", "Attention needed: unusual number of privilege changes by one administrator", "privilege changes",
    { kind: "events", types: ["ADMIN_PRIVILEGE_CHANGE"], groupBy: "adminId" }, cfg("MEDIUM", 3, 60), true),
  events("admin.break_glass_use", "Break-glass access used", "ACCOUNT_COMPROMISE", "Emergency (break-glass) access was used. Every use is reviewed.", "Attention needed: break-glass access was used", "break-glass uses",
    { kind: "events", types: ["BREAK_GLASS_USED"], groupBy: "adminId" }, cfg("HIGH", 1, 60), true),
  events("admin.session_anomalies", "Admin session anomalies", "ACCOUNT_COMPROMISE", "Sessions were refused or ended by the session policy repeatedly for the same administrator.", "Attention needed: repeated session anomalies for one administrator", "session anomalies",
    { kind: "events", types: ["ADMIN_SESSION_ANOMALY"], groupBy: "adminId" }, cfg("MEDIUM", 3, 60)),
  events("security.config_changes", "Unusual number of security configuration changes", "AUTHORIZATION_FAILURE", "Security configuration was changed unusually often by the same administrator.", "Attention needed: unusual number of security configuration changes", "configuration changes",
    { kind: "events", types: ["SECURITY_CONFIG_CHANGED"], groupBy: "adminId" }, cfg("MEDIUM", 3, 60), true),
  // ---- data access ----
  events("data.bulk_exports", "Bulk exports", "DATA_EXPOSURE", "An administrator produced several data exports in a short window.", "Suspicious activity detected: several data exports by one administrator", "exports",
    { kind: "events", types: ["BULK_EXPORT"], groupBy: "adminId" }, cfg("HIGH", 5, 60), true),
  events("data.excessive_searches", "Excessive profile searches", "DATA_EXPOSURE", "An administrator ran an unusually large number of profile searches.", "Suspicious activity detected: excessive profile searches by one administrator", "searches",
    { kind: "events", types: ["PROFILE_SEARCH"], groupBy: "adminId" }, cfg("MEDIUM", 150, 60)),
  events("data.sensitive_record_burst", "Burst of contact or document access", "DATA_EXPOSURE", "An administrator opened many contact details or documents in a short window.", "Suspicious activity detected: burst of contact or document access", "record accesses",
    { kind: "events", types: ["SENSITIVE_RECORD_ACCESS"], groupBy: "adminId" }, cfg("MEDIUM", 40, 60)),
  events("doc.unauthorized_access", "Repeated unauthorised document requests", "DOCUMENT_ACCESS", "Documents were requested without permission several times.", "Suspicious activity detected: repeated unauthorised document requests", "refused document requests",
    { kind: "events", types: ["DOCUMENT_UNAUTHORIZED_ACCESS"], groupBy: "adminId" }, cfg("HIGH", 3, 60)),
  events("doc.tamper_detected", "Document integrity mismatch", "DOCUMENT_ACCESS", "A stored document no longer matches its recorded hash.", "Attention needed: a document failed its integrity check", "integrity mismatches",
    { kind: "events", types: ["DOCUMENT_TAMPER_DETECTED"], groupBy: "profileId" }, cfg("CRITICAL", 1, 1440), true),
  // ---- API ----
  events("api.permission_denied_burst", "Repeated permission refusals", "AUTHORIZATION_FAILURE", "An administrator account was refused for lack of permission many times.", "Suspicious activity detected: repeated permission refusals for one administrator", "refusals",
    { kind: "events", types: ["PERMISSION_DENIED"], groupBy: "adminId" }, cfg("MEDIUM", 15, 30)),
  events("api.auth_failure_burst", "Repeated unauthenticated API requests", "API_ATTACK", "Many requests from one network were refused for failed authentication.", "Suspicious activity detected: repeated unauthenticated requests from one network", "refused requests",
    { kind: "events", types: ["API_AUTH_FAILURE"], groupBy: "ipHash" }, cfg("MEDIUM", 20, 30)),
  events("api.rate_limit_abuse", "Rate limits hit repeatedly", "API_ATTACK", "The same network hit a rate limit in several separate windows.", "Suspicious activity detected: rate limits hit repeatedly from one network", "rate-limit windows exceeded",
    { kind: "events", types: ["RATE_LIMIT_EXCEEDED"], groupBy: "ipHash" }, cfg("MEDIUM", 3, 60)),
  // ---- webhooks ----
  events("webhook.signature_failures", "Webhook signature failures", "WEBHOOK_COMPROMISE", "An inbound webhook endpoint received several deliveries that failed signature verification.", "Suspicious activity detected: webhook deliveries failing signature checks", "failed deliveries",
    { kind: "events", types: ["WEBHOOK_SIGNATURE_FAILURE"], groupBy: "subjectKey", providerFromMeta: true }, cfg("HIGH", 5, 30), true),
  events("webhook.replays", "Webhook replays", "WEBHOOK_COMPROMISE", "Stale (replayed) webhook deliveries were received for the same endpoint.", "Suspicious activity detected: replayed webhook deliveries", "replayed deliveries",
    { kind: "events", types: ["WEBHOOK_REPLAY_ATTEMPT"], groupBy: "subjectKey", outcomes: ["STALE"], providerFromMeta: true }, cfg("MEDIUM", 3, 60)),
  events("webhook.duplicate_flood", "Webhook duplicate flood", "WEBHOOK_COMPROMISE", "An unusually large number of duplicate webhook deliveries for the same endpoint (provider retries are normal in small numbers).", "Attention needed: unusual volume of duplicate webhook deliveries", "duplicate deliveries",
    { kind: "events", types: ["WEBHOOK_REPLAY_ATTEMPT"], groupBy: "subjectKey", outcomes: ["DUPLICATE"], providerFromMeta: true }, cfg("LOW", 100, 60)),
  // ---- AI ----
  events("ai.prompt_injection", "Prompt-injection patterns", "AI_SECURITY", "An administrator's AI input matched prompt-injection patterns several times (pattern codes only are recorded).", "Suspicious activity detected: prompt-injection patterns in AI input", "flagged inputs",
    { kind: "events", types: ["AI_PROMPT_INJECTION_SUSPECTED"], groupBy: "adminId" }, cfg("MEDIUM", 3, 60)),
  events("ai.unauthorized_action", "AI asked to take a restricted action", "AI_SECURITY", "An administrator repeatedly asked the AI for an action it is never allowed to take.", "Suspicious activity detected: repeated requests for restricted AI actions", "restricted-action requests",
    { kind: "events", types: ["AI_UNAUTHORIZED_ACTION_ATTEMPT"], groupBy: "adminId" }, cfg("HIGH", 2, 60)),
  { key: "ai.denied_burst", name: "Repeated AI access denials", category: "AI_SECURITY", description: "An administrator's AI requests were denied many times.", source: "AiRequest", title: "Suspicious activity detected: repeated AI access denials", unit: "denied AI requests", query: { kind: "aiDenied" }, defaults: cfg("MEDIUM", 10, 60), protectedRule: false },
  // ---- backup ----
  { key: "backup.failed", name: "Backup failed", category: "BACKUP_RECOVERY_FAILURE", description: "A backup run ended in failure.", source: "BackupRun", title: "Attention needed: a backup failed", unit: "failed backups", query: { kind: "backupFailed" }, defaults: cfg("CRITICAL", 1, 1440), protectedRule: true },
  events("backup.deletion_attempts", "Backup deletion attempted", "BACKUP_RECOVERY_FAILURE", "Something tried to delete a backup outside the retention policy (blocked).", "Attention needed: a backup deletion outside the retention policy was blocked", "blocked deletions",
    { kind: "events", types: ["BACKUP_DELETION_ATTEMPT"], groupBy: "subjectKey" }, cfg("CRITICAL", 1, 1440), true),
];

const BY_KEY = new Map(RULES.map((r) => [r.key, r]));
export const getRuleDefinition = (key: string): RuleDefinition | undefined => BY_KEY.get(key);
export const ruleKeys = (): string[] => RULES.map((r) => r.key);
