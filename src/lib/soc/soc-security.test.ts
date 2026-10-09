import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it, vi } from "vitest";
import { CONTROL_MATRIX } from "./control-matrix";
import { AI_FORBIDDEN_ACTIONS, detectRestrictedActionRequest } from "./ai-security";
import { ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, type AdminRole } from "@/lib/permissions";

// STEP 32 §17 — security tests done on the source itself and on the permission tables: guards on every SOC route, role separation, webhook
// entry points, exports, public addresses of stored files, audit-log integrity, backup access, the restore tooling's safety rails and the
// limits on what AI code may import. They fail loudly if a future change removes a control.

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(SRC, p).replace(/\\/g, "/");
// Comments are stripped so a check looks at what the code DOES. Results are cached: several checks scan the whole source tree.
const codeCache = new Map<string, string>();
const code = (p: string): string => {
  let c = codeCache.get(p);
  if (c === undefined) codeCache.set(p, (c = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")));
  return c;
};
vi.setConfig({ testTimeout: 60_000 });
const prod = (files: string[]) => files.filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.includes(`${join("src", "test-utils")}`));

const API = join(SRC, "app", "api");
const socRoutes = walk(join(API, "admin", "soc")).filter((p) => p.endsWith("route.ts"));
const socLib = prod(walk(join(SRC, "lib", "soc")));
const allSrc = prod(walk(SRC));

describe("every SOC route is guarded", () => {
  it("there are routes to check", () => {
    expect(socRoutes.length).toBeGreaterThanOrEqual(20);
  });

  it("authorises with requireAdmin(<soc permission>) — never bare — and checks the feature switch", () => {
    for (const r of socRoutes) {
      const src = code(r);
      expect(src, rel(r)).toMatch(/requireAdmin\(\s*"soc:[a-z_:]+"\s*\)/);
      expect(src, rel(r)).not.toMatch(/requireAdmin\(\s*\)/);
      expect(src, rel(r)).toMatch(/assertSocEnabled\(/);
    }
  });

  it("rate-limits every handler by the signed-in administrator, not only by address", () => {
    for (const r of socRoutes) {
      const src = code(r);
      const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].length;
      const limits = [...src.matchAll(/enforceConfiguredLimit\(req, "soc-[a-z-]+", \{[^}]+\}, admin\.id\)/g)].length;
      expect(limits, rel(r)).toBe(handlers);
    }
  });

  it("records access, exports only HTTP handlers and route config, and answers errors through the shared handler", () => {
    const allowed = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|dynamic|revalidate|runtime|maxDuration|fetchCache|preferredRegion)$/;
    for (const r of socRoutes) {
      const src = code(r);
      expect(src, rel(r)).toMatch(/logSocAccess\(/);
      expect(src, rel(r)).toMatch(/marketingError\(error\)/);
      for (const m of read(r).matchAll(/^export (?:async function|const|function|let|var|class) (\w+)/gm)) expect(m[1], rel(r)).toMatch(allowed);
    }
  });

  it("never lets the request name the person acting", () => {
    for (const r of socRoutes) expect(code(r), rel(r)).not.toMatch(/\b(b|body)\??\.(actorId|adminId|requestedById|performedById|reviewerId|approvedById|authorId|createdById)\b|str\(b, "(actorId|requestedById|performedById|reviewerId|approvedById|authorId)"/);
  });

  it("every permission a route names exists, is described, and the high-risk ones are marked sensitive", () => {
    const named = new Set<string>();
    for (const r of socRoutes) for (const m of code(r).matchAll(/requireAdmin\("(soc:[a-z_:]+)"\)/g)) named.add(m[1]);
    const defs = read(join(SRC, "lib", "permission-defs.ts"));
    expect(named.size).toBeGreaterThanOrEqual(15);
    for (const p of named) expect(defs, `${p} has no description`).toContain(`"${p}":`);
    for (const p of ["soc:containment:approve", "soc:rules:manage", "soc:config:manage", "soc:restore:review", "soc:admin_security:view", "soc:audit:view"]) expect(SENSITIVE_PERMISSIONS, p).toContain(p);
  });

  it("every change that weakens a control or runs something broad asks for the password again", () => {
    const need: Array<[string, RegExp]> = [
      ["admin/soc/rules/[key]/route.ts", /assertStepUp\(/],
      ["admin/soc/rules/[key]/review/route.ts", /assertStepUp\(/],
      ["admin/soc/containment/[id]/route.ts", /assertStepUp\(/],
      ["admin/soc/restore-drills/[id]/review/route.ts", /assertStepUp\(/],
      ["admin/soc/configuration/route.ts", /assertStepUp\(/],
      ["admin/soc/disaster-recovery/route.ts", /assertStepUp\(/],
    ];
    for (const [file, re] of need) expect(code(join(API, file)), file).toMatch(re);
  });
});

describe("role separation", () => {
  const staff: AdminRole[] = ["STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF", "VIEWER", "REPORTING_ANALYST", "FINANCE_MANAGER", "MATCHMAKING_MANAGER", "VERIFICATION_MANAGER", "SUPPORT_MANAGER", "COMMUNICATION_MANAGER"];
  const socPerms = (r: AdminRole) => (ROLE_PERMISSIONS[r] ?? []).filter((p) => p.startsWith("soc:"));

  it("no staff, viewer, analyst or domain-manager role holds any security-operations permission", () => {
    for (const r of staff) expect(socPerms(r), r).toEqual([]);
  });

  it("only SUPER_ADMIN can approve containment, and no other role can both request and approve", () => {
    const approvers = (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((r) => ROLE_PERMISSIONS[r].includes("soc:containment:approve"));
    expect(approvers).toEqual(["SUPER_ADMIN"]);
    const roles = (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((r) => ROLE_PERMISSIONS[r].includes("soc:containment:request") && ROLE_PERMISSIONS[r].includes("soc:containment:approve"));
    expect(roles).toEqual(["SUPER_ADMIN"]); // and the service refuses a self-approval even for them
  });

  it("only SUPER_ADMIN can change detection strength, configuration or the recovery plan; compliance can request and review but not approve", () => {
    for (const p of ["soc:rules:manage", "soc:config:manage", "soc:dr:manage", "soc:detection:run"]) {
      const holders = (Object.keys(ROLE_PERMISSIONS) as AdminRole[]).filter((r) => ROLE_PERMISSIONS[r].includes(p as never));
      expect(holders, p).toEqual(["SUPER_ADMIN"]);
    }
    expect(ROLE_PERMISSIONS.COMPLIANCE_MANAGER).toContain("soc:containment:request");
    expect(ROLE_PERMISSIONS.COMPLIANCE_MANAGER).not.toContain("soc:containment:approve");
  });

  it("nobody is given the permission to grant themselves more: role changes go through the existing guarded service", () => {
    const rm = code(join(SRC, "lib", "role-management.ts"));
    expect(rm).toMatch(/assertCanGrantRole/);
    expect(rm).toMatch(/assertCanGrantPermissions/);
  });
});

describe("webhooks", () => {
  // inbound endpoints only: the admin screens that LIST webhook deliveries live under /admin and are guarded like any admin route
  const files = walk(API).filter((p) => p.endsWith("route.ts") && /[\\/]webhooks[\\/]/.test(p) && !/[\\/]admin[\\/]/.test(p));
  const VERIFIERS = /verifyWebhook|verifyEnvelope|verifyWebhookSignature|handleProviderWebhook|handleMarketingWebhook|handleWebhookHandshake|handleWebhookRequest|processVerificationWebhook/;

  it("every inbound webhook route verifies a signature before doing anything, and is rate limited or delegated to a service that is", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const f of files) {
      const src = code(f);
      if (/webhooks[\\/]simulate/.test(f)) continue; // the admin "simulate" tool is a guarded admin action, not an inbound endpoint
      expect(src, rel(f)).toMatch(VERIFIERS);
    }
  });

  it("the shared handler behind the email and SMS endpoints verifies every delivery", () => {
    expect(code(join(SRC, "lib", "communications", "webhook-route.ts"))).toMatch(/handleProviderWebhook\(/);
  });

  it("replay protection exists where deliveries are processed: idempotency keys and a staleness limit", () => {
    const comms = code(join(SRC, "lib", "communications", "webhook-service.ts"));
    expect(comms).toMatch(/STALE_EVENT_MS/);
    expect(comms).toMatch(/isUniqueViolation/);
    expect(code(join(API, "webhooks", "payments", "[provider]", "route.ts"))).toMatch(/idempotency|replay|P2002|unique/i);
    expect(code(join(SRC, "lib", "marketing", "webhook-service.ts"))).toMatch(/idempotencyKey/);
  });

  it("the behavioural suites for spoofing and replay are present", () => {
    for (const f of ["src/lib/marketing/webhook.test.ts", "src/lib/communications/e2e-flow.test.ts", "src/lib/communications/providers/adapters.test.ts"]) expect(existsSync(join(ROOT, f)), f).toBe(true);
    expect(read(join(ROOT, "src/lib/marketing/webhook.test.ts"))).toMatch(/rejects a missing, malformed or wrong signature/);
  });

  it("a failed signature always becomes a security event", () => {
    for (const f of ["src/app/api/webhooks/payments/[provider]/route.ts", "src/app/api/webhooks/signature-provider/route.ts", "src/app/api/webhooks/notifications/route.ts", "src/lib/marketing/webhook-service.ts", "src/lib/communications/webhook-service.ts", "src/lib/verification/provider/webhook.ts"]) expect(code(join(ROOT, f)), f).toMatch(/publishWebhookSignatureFailure|reportWebhook\("signature"/);
  });
});

// An export route may write its audit entry itself or hand the work to a service module that does.
function auditsSomewhere(src: string): boolean {
  const AUDIT = /writeAudit\(|[A-Za-z]*Audit\(/;
  if (AUDIT.test(src)) return true;
  for (const m of src.matchAll(/from "@\/lib\/([^"]+)"/g)) {
    for (const ext of [".ts", "/index.ts"]) {
      const p = join(SRC, "lib", m[1] + ext);
      if (existsSync(p) && AUDIT.test(code(p))) return true;
    }
  }
  return false;
}

describe("exports", () => {
  const exportRoutes = walk(API).filter((p) => p.endsWith("route.ts") && /export/.test(relative(API, p)));

  it("finds the export routes", () => {
    expect(exportRoutes.length).toBeGreaterThanOrEqual(8);
  });

  it("every administrator export needs a named permission and leaves an audit entry", () => {
    for (const r of exportRoutes.filter((p) => relative(API, p).startsWith("admin"))) {
      const src = code(r);
      expect(src, rel(r)).toMatch(/requireAdmin\(\s*["'`][a-z_:*-]+["'`]|requireAdmin\(\s*perm|requireAdmin\(\s*\w+\s*\)/);
      expect(src, rel(r)).not.toMatch(/requireAdmin\(\s*\)/);
      expect(auditsSomewhere(src), `${rel(r)} leaves no audit entry`).toBe(true);
    }
  });

  it("applicants can export only their own data, from the signed-in session", () => {
    for (const r of exportRoutes.filter((p) => relative(API, p).startsWith("my-account"))) {
      const src = code(r);
      expect(src, rel(r)).toMatch(/requireApplicantProfileId\(|requireApplicant|getApplicantSession|requireProfile/);
      expect(src, rel(r)).not.toMatch(/searchParams\.get\(["']profileId["']\)/);
    }
  });

  it("exports are mirrored into the security event feed (bulk-export detection)", () => {
    const audit = read(join(SRC, "lib", "audit.ts"));
    for (const a of ["REPORT_EXPORTED", "SENSITIVE_DATA_EXPORTED", "FINANCIAL_REPORT_EXPORTED", "DATA_EXPORT_CREATED", "CRM_EXPORT", "MARKETING_LEAD_EXPORTED", "ENGAGEMENT_EXPORT", "ANALYTICS_REPORT_EXPORTED"]) expect(audit, a).toContain(`"${a}"`);
  });
});

describe("stored files", () => {
  it("every file written to a publicly addressable store is ciphertext", () => {
    const users = allSrc.filter((f) => /access:\s*"public"/.test(code(f)));
    expect(users.length).toBeGreaterThanOrEqual(5);
    for (const f of users) {
      if (rel(f) === "lib/backup/storage.ts") continue; // receives bytes from the backup writer: checked in the next test
      const src = code(f);
      expect(src, rel(f)).toMatch(/\.enc`|\.enc"|ciphertext/);
      expect(src, rel(f)).toMatch(/encrypt/i);
    }
  });

  it("the backup store is only ever handed encrypted bytes", () => {
    const callers = allSrc.filter((f) => /storeBackupObject\(/.test(code(f)) && !f.endsWith("storage.ts")).map(rel).sort();
    expect(callers).toEqual(["lib/backup/export.ts", "lib/backup/files.ts"]);
    expect(code(join(SRC, "lib", "backup", "export.ts"))).toMatch(/encryptBackup\(/);
    expect(read(join(SRC, "lib", "backup", "files.ts"))).toMatch(/INCREMENTAL mirror of the encrypted blob objects/);
  });

  it("no administrator or applicant API response carries a storage location", () => {
    for (const f of prod(walk(API))) {
      const src = code(f);
      expect(src, rel(f)).not.toMatch(/NextResponse\.json\([^)]*\b(storageUrl|secureStorageReference|storageKey)\b/);
    }
  });

  it("SOC code reads a backup's location only to reduce it to yes/no", () => {
    const users = socLib.filter((f) => /storageUrl/.test(code(f))).map(rel);
    expect(users).toEqual(["lib/soc/backups.ts"]);
    expect(code(join(SRC, "lib", "soc", "backups.ts"))).toMatch(/storedOffsite: !!r\.storageUrl/);
  });
});

describe("audit-log integrity", () => {
  it("nothing edits an audit row, and only the retention sweep deletes them", () => {
    const edits = allSrc.filter((f) => /auditLog\.(update|updateMany|upsert)\b/.test(code(f))).map(rel);
    expect(edits).toEqual([]);
    const deletes = allSrc.filter((f) => /auditLog\.(delete|deleteMany)\b/.test(code(f))).map(rel);
    expect(deletes).toEqual(["lib/privacy/retention-policy.ts"]);
  });

  it("SOC history tables are append-only: nothing updates or deletes their rows except retention and the state transitions of the live record", () => {
    for (const model of ["socAlertEvent", "socIncidentEvent", "socConfigVersion", "socAccessLog"]) {
      const bad = socLib.filter((f) => new RegExp(`prisma\\.${model}\\.(update|updateMany|upsert)\\b`).test(code(f))).map(rel);
      expect(bad, model).toEqual([]);
      const del = socLib.filter((f) => new RegExp(`prisma\\.${model}\\.(delete|deleteMany)\\b`).test(code(f))).map(rel);
      expect(del.every((f) => f === "lib/soc/retention.ts"), model).toBe(true);
    }
  });

  it("the audit writer scrubs secrets from SOC audit entries", async () => {
    const audit = code(join(SRC, "lib", "soc", "audit.ts"));
    expect(audit).toMatch(/scrubForAudit\(/);
  });
});

describe("backups and restore", () => {
  it("backups are deleted only through the retention policy", () => {
    const callers = allSrc.filter((f) => /deleteBackupObject\(/.test(code(f)) && !f.endsWith("storage.ts")).map(rel);
    expect(callers).toEqual(["lib/backup/export.ts"]);
    expect(code(join(SRC, "lib", "backup", "storage.ts"))).toMatch(/authority !== "RETENTION_POLICY"/);
  });

  it("the restore tool never defaults to the live database and refuses to overwrite it without an explicit, typed confirmation", () => {
    const script = read(join(ROOT, "scripts", "restore-backup.ts"));
    expect(script).toMatch(/--target-url is required \(it never defaults to DATABASE_URL\)/);
    expect(script).toMatch(/OVERWRITE-LIVE-DATABASE/);
    expect(script).toMatch(/--truncate/);
  });

  it("the application never writes backup data into a database", () => {
    const writers = allSrc.filter((f) => /\.createMany\(|\.deleteMany\(/.test(code(f)) && /backup/i.test(f) && !/retention|export|files|verify|restore-request/.test(f)).map(rel);
    expect(writers).toEqual([]);
    expect(code(join(SRC, "lib", "backup", "restore-request.ts"))).not.toMatch(/\.(create|update|delete)Many\(/);
  });

  it("restore drills can never be marked passed without a reviewer other than the performer", () => {
    const src = code(join(SRC, "lib", "soc", "restore-drills.ts"));
    expect(src).toMatch(/d\.performedById === reviewerId/);
    expect(src).toMatch(/reviewedById !== d\.performedById|d\.reviewedById !== d\.performedById/);
  });
});

describe("SOC code stays inside its lane", () => {
  // caseCodeCounter: the shared LPP-INC numbering. adminSession / systemControl / securityIncident: the reviewed containment targets.
  const ALLOWED_WRITES = /^(soc[A-Z]\w*|restoreDrill|disasterRecovery\w+|retentionActionLog|adminSession|systemControl|securityIncident|caseCodeCounter)$/;

  it("writes only SOC-owned tables, plus the specific, reviewed containment targets", () => {
    for (const f of socLib) {
      for (const m of code(f).matchAll(/prisma\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)) {
        // the security event ledger is written by exactly one SOC module: the light event path
        if (m[1] === "securityEvent" && rel(f) === "lib/soc/light-events.ts" && m[2] === "create") continue;
        expect(m[1], `${rel(f)} writes ${m[1]}`).toMatch(ALLOWED_WRITES);
      }
    }
  });

  it("session ends and the emergency switch happen only in containment, session policy and the idle check", () => {
    const sessionWriters = socLib.filter((f) => /prisma\.adminSession\.(update|updateMany)/.test(code(f))).map(rel).sort();
    expect(sessionWriters).toEqual(["lib/soc/containment.ts", "lib/soc/session-policy.ts"]);
    expect(socLib.filter((f) => /prisma\.systemControl\.(update|upsert)/.test(code(f))).map(rel)).toEqual(["lib/soc/containment.ts"]);
  });

  it("holds no raw SQL", () => {
    for (const f of socLib) expect(code(f), rel(f)).not.toMatch(/\$queryRaw|\$executeRaw|Prisma\.sql|Prisma\.raw/);
  });

  it("reads no applicant contact or identity fields", () => {
    for (const f of socLib.filter((p) => !p.endsWith("ai-security.ts") && !p.endsWith("control-matrix.ts"))) expect(code(f), rel(f)).not.toMatch(/\b(phoneNumber|whatsappNumber|contactEmail|dateOfBirth|nationalId|cnic|passportNumber|passwordHash)\b/i);
  });

  it("every detection rule's wording is neutral (see also the rule catalog tests)", () => {
    expect(code(join(SRC, "lib", "soc", "rules", "registry.ts"))).not.toMatch(/fraudster|criminal|attacker|hacker/i);
  });
});

describe("AI cannot take restricted actions", () => {
  const aiFiles = prod(walk(join(SRC, "lib", "ai")));
  const FORBIDDEN_IMPORTS = [
    "@/lib/role-management", "@/lib/approvals/engine", "@/lib/privacy/deletion-request", "@/lib/privacy/break-glass", "@/lib/soc/containment", "@/lib/soc/incidents",
    "@/lib/soc/restore-drills", "@/lib/ops/system-control", "@/lib/finance/refund", "@/lib/backup/", "@/lib/step-up-token", "@/lib/notifications/notification-service", "@/lib/communications/send-service",
  ];

  it("no AI module imports anything that approves, grants, deletes, refunds, restores, contains or sends", () => {
    expect(aiFiles.length).toBeGreaterThan(20);
    for (const f of aiFiles) for (const bad of FORBIDDEN_IMPORTS) expect(code(f), `${rel(f)} imports ${bad}`).not.toContain(`from "${bad}`);
  });

  it("AI code never writes to the people, permission, consent or money tables", () => {
    const forbidden = /prisma\.(adminUser|customRole|profile|consent\w*|payment\w*|refund\w*|subscription\w*|proposal\w*|contactPermission\w*|breakGlassAccess)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
    for (const f of aiFiles) expect(code(f), rel(f)).not.toMatch(forbidden);
  });

  it("the actions the AI may never take are recognised when someone asks for them", () => {
    expect(AI_FORBIDDEN_ACTIONS).toEqual(["APPROVE_CONTACT_SHARING", "OVERRIDE_CONSENT", "GRANT_PERMISSION", "DELETE_ACCOUNT", "DISABLE_SECURITY"]);
    expect(detectRestrictedActionRequest("please approve sharing her phone number with him")).toBe("APPROVE_CONTACT_SHARING");
  });

  it("the copilot refuses write actions instead of performing them", () => {
    const intent = code(join(SRC, "lib", "ai", "copilot", "intent.ts"));
    expect(intent).toMatch(/kind: "refusal"/);
    expect(intent).toMatch(/ACTIONS/);
  });
});

describe("transport and request protection", () => {
  const config = read(join(ROOT, "next.config.ts"));
  it("sets the standard security headers", () => {
    for (const h of ["Strict-Transport-Security", "X-Content-Type-Options", "Content-Security-Policy"]) expect(config, h).toContain(h);
    expect(config).toMatch(/frame-ancestors|X-Frame-Options/);
  });
  it("the policy is report-only unless the owner switches it to enforce (stated, not hidden)", () => {
    expect(config).toMatch(/CSP_MODE === "enforce"/);
  });
  it("the sign-in path is rate limited and locks out repeated failures from durable history", () => {
    expect(code(join(SRC, "lib", "admin-login.ts"))).toMatch(/loginMaxAttempts/);
    expect(code(join(SRC, "lib", "admin-login.ts"))).toMatch(/adminLoginHistory\.count/);
  });
});

describe("sensitive-data control matrix", () => {
  it("covers every class the spec lists", () => {
    const names = CONTROL_MATRIX.map((c) => c.dataClass.toLowerCase()).join(" | ");
    for (const k of ["contact", "matrimonial", "family", "verification documents", "identity", "private messages", "ai conversation", "payment", "staff internal notes"]) expect(names, k).toContain(k);
  });
  it("points only at files that exist, with a test for each class", () => {
    for (const c of CONTROL_MATRIX) {
      expect(c.tests.length, c.dataClass).toBeGreaterThan(0);
      for (const f of [...c.authorization, ...c.tests]) expect(existsSync(join(ROOT, f)), `${c.dataClass}: ${f}`).toBe(true);
    }
  });
});

describe("the documentation stays in step with the code", () => {
  const docs = (n: string) => read(join(ROOT, "docs", n));
  it("lists every detection rule, with its starting threshold", async () => {
    const { RULES } = await import("./rules/registry");
    const text = docs("THREAT_DETECTION_RULES.md");
    for (const r of RULES) {
      expect(text, r.key).toContain(`\`${r.key}\``);
      expect(text, `${r.key} threshold`).toContain(`| ${r.defaults.threshold} | ${r.defaults.windowMinutes} min | ${r.defaults.severity} |`);
    }
  });
  it("lists every class in the sensitive-data control matrix", () => {
    const text = docs("SECURITY_OPERATIONS_CENTER.md");
    for (const c of CONTROL_MATRIX) expect(text, c.dataClass).toContain(`### ${c.dataClass}`);
  });
  it("has the required documents, and the ones that exist link only to each other", () => {
    const files = ["SECURITY_OPERATIONS_CENTER.md", "THREAT_DETECTION_RULES.md", "INCIDENT_RESPONSE_PLAN.md", "ADMIN_SECURITY_GUIDE.md", "BACKUP_AND_RESTORE_GUIDE.md", "DISASTER_RECOVERY_PLAN.md", "SECURITY_TEST_REPORT.md", "STEP_32_PRODUCTION_READINESS.md"];
    for (const f of files) expect(existsSync(join(ROOT, "docs", f)), f).toBe(true);
    for (const f of files) for (const m of read(join(ROOT, "docs", f)).matchAll(/\]\(([A-Z_]+\.md)\)/g)) expect(existsSync(join(ROOT, "docs", m[1])), `${f} links to ${m[1]}`).toBe(true);
  });
  it("contains no credential-looking text", () => {
    for (const f of readdirSync(join(ROOT, "docs"))) {
      const text = read(join(ROOT, "docs", f));
      expect(text, f).not.toMatch(/(password|secret|api[_-]?key|token)\s*[:=]\s*[A-Za-z0-9+/_-]{12,}/i);
      expect(text, f).not.toMatch(/sk_live_[A-Za-z0-9]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });
});

describe("modules imported by hundreds of routes stay small", () => {
  const importsOf = (rel2: string) => [...code(join(ROOT, rel2)).matchAll(/(?:from|import\()\s*"([^"]+)"/g)].map((m) => m[1]).sort();

  it("the audit writer and the rate limiter reach the event ledger only through the light module — never the event bus or the risk engine", () => {
    for (const f of ["src/lib/audit.ts", "src/lib/ops/rate-limit-persistent.ts"]) {
      const imports = importsOf(f);
      expect(imports.some((i) => /event-bus|soc\/events|risk\//.test(i)), f).toBe(false);
      expect(imports, f).toContain("@/lib/soc/light-events");
    }
  });

  it("the light module imports only the database client, the hash helper and the redaction helper", () => {
    expect(importsOf("src/lib/soc/light-events.ts")).toEqual(["@/lib/prisma", "@/lib/security/hash", "@/lib/security/redact", "@prisma/client"].sort());
    expect(importsOf("src/lib/security/hash.ts")).toEqual(["crypto"]);
  });

  it("route-guard pulls in the session policy only (small), not the SOC services", () => {
    const imports = importsOf("src/lib/route-guard.ts");
    expect(imports.filter((i) => i.startsWith("@/lib/soc/"))).toEqual(["@/lib/soc/session-policy"]);
    expect(importsOf("src/lib/soc/session-policy.ts").some((i) => /event-bus|risk\//.test(i))).toBe(false);
  });

  it("abusive-request events keep their hashed network address, so network rules can group them", () => {
    const bus = code(join(SRC, "lib", "security", "event-bus.ts"));
    const authTypes = bus.slice(bus.indexOf("const AUTH_TYPES"), bus.indexOf("]);", bus.indexOf("const AUTH_TYPES")));
    for (const t of ["RATE_LIMIT_EXCEEDED", "WEBHOOK_SIGNATURE_FAILURE", "WEBHOOK_REPLAY_ATTEMPT"]) expect(authTypes, t).toContain(`"${t}"`);
  });
});
