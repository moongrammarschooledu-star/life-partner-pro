#!/usr/bin/env node
/**
 * STEP 33 — per-handler static audit of every API route.
 *
 * The existing coverage test proves that a FILE mentions an authentication call. That is weaker than it sounds: a file can guard its GET
 * handler and leave its POST open, or call requireAdmin() with no permission (any administrator, including a read-only viewer, passes).
 * This script splits each route file into its exported HTTP handlers and reports, per handler:
 *   - which actor guard it uses (admin / applicant / family / session / webhook-signature / cron-secret / none)
 *   - for admin guards: the permission it asks for (none = any administrator)
 *   - whether the handler is state-changing
 *   - whether state-changing handlers leave an audit trail, validate input and are inside a try/catch that maps errors safely
 *
 * Usage:  node scripts/audit-routes.mjs [--json] [--fail-on-high]
 * It reads source only (no network, no database) and prints no secret values.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join(process.cwd(), "src", "app", "api");
const asJson = process.argv.includes("--json");
const failOnHigh = process.argv.includes("--fail-on-high");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

// Split a route file into { METHOD -> body text }. Handles `export async function X(`, `export const X =` and `export const X = wrap(...)`.
function handlers(src) {
  const found = [];
  const re = /export\s+(?:async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b|const\s+(GET|POST|PUT|PATCH|DELETE)\b)/g;
  let m;
  while ((m = re.exec(src))) found.push({ method: m[1] || m[2], start: m.index });
  // `export const { GET, POST } = handlers` style
  const destructured = src.match(/export\s+const\s*\{([^}]*)\}\s*=/);
  if (destructured) for (const name of destructured[1].split(",").map((s) => s.trim())) if (METHODS.includes(name)) found.push({ method: name, start: destructured.index });
  found.sort((a, b) => a.start - b.start);
  return found.map((h, i) => {
    let body = src.slice(h.start, i + 1 < found.length ? found[i + 1].start : src.length);
    // export const POST = withRequestMetrics("...", postHandler)  → analyse postHandler's own body too
    if (body.length < 600) {
      for (const id of new Set(body.match(/[A-Za-z0-9_]+(?=\s*[,)])/g) || [])) {
        const start = src.search(new RegExp("function\\s+" + id + "\\s*\\("));
        if (start < 0) continue;
        const rest = src.slice(start);
        const next = rest.slice(10).search(/\n(?:export\s|(?:async\s+)?function\s)/);
        body += "\n" + (next < 0 ? rest : rest.slice(0, next + 10));
      }
    }
    return { method: h.method, body };
  });
}

// Helper functions in the same file that a handler may delegate its guard to (e.g. `async function guard() { return requireAdmin("x") }`).
function sharedGuardNames(src) {
  const names = [];
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?::[^{]+)?\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(src))) if (/requireAdmin\(|requireApplicantProfileId\(|requireFamilyMemberId\(|await auth\(\)/.test(m[2]) && !/^(GET|POST|PUT|PATCH|DELETE)$/.test(m[1])) names.push(m[1]);
  return names;
}

const rows = [];
for (const file of walk(API_ROOT)) {
  const src = readFileSync(file, "utf8");
  const path = "/api/" + relative(API_ROOT, file).split(sep).slice(0, -1).join("/");
  const shared = sharedGuardNames(src);
  const hs = handlers(src);
  if (!hs.length) rows.push({ path, method: "?", guard: "unparsed", permission: null, mutating: false, notes: ["no exported handler found"], severity: "MEDIUM" });
  for (const h of hs) {
    const b = h.body;
    const mutating = MUTATING.has(h.method);
    let guard = "none";
    let permission = null;
    const adminCall = b.match(/requireAdmin\(\s*(["'`][^"'`]+["'`])?/);
    if (adminCall) { guard = "admin"; permission = adminCall[1] ? adminCall[1].slice(1, -1) : null; }
    else if (/requireApplicantProfileId\(|verifyProfileToken\(/.test(b)) guard = "applicant";
    else if (/requireFamilyMemberId\(/.test(b)) guard = "family";
    else if (/await auth\(\)/.test(b)) guard = "session";
    else if (/verifyWebhook\(|verifySignature|handleInbound|verifyHmac|timingSafeEqual/.test(b) || /webhook/i.test(path)) guard = "webhook-signature";
    else if (/CRON_SECRET|NOTIFICATION_WEBHOOK_SECRET|CI_EVIDENCE_TOKEN/.test(b) || /\/cron\//.test(path)) guard = "secret";
    else if (shared.some((n) => new RegExp("\\b" + n + "\\(").test(b))) guard = "shared-guard";
    else if (/withRequestMetrics\(/.test(b) && /requireAdmin\(/.test(src)) guard = "admin(wrapped)";

    const notes = [];
    let severity = "OK";
    const bump = (s) => { const order = ["OK", "LOW", "MEDIUM", "HIGH", "CRITICAL"]; if (order.indexOf(s) > order.indexOf(severity)) severity = s; };

    const publicByDesign = /\/api\/(register|support|update-request|my-status|verify\/|health|system-state|client-errors|my-billing\/packages|family\/(register|login|logout)|marketing\/|auth\/)/.test(path) || guard === "webhook-signature" || guard === "secret" || /\/admin\/auth\/(precheck|verify-otp|forgot-password|reset-password)/.test(path);
    if (guard === "none" && !publicByDesign) { notes.push("no recognised guard"); bump(mutating ? "HIGH" : "MEDIUM"); }
    const inlinePermission = /\.permissions\.(includes|some)\(|hasPermission\(|hasAnyPermission\(|requirePermission\(|\bcan[A-Z][A-Za-z]*\(|\bassert[A-Z][A-Za-z]*\(|\bensure[A-Z][A-Za-z]*\(|\bresolve[A-Z][A-Za-z]*(?:Access|Permission)[A-Za-z]*\(|PERMISSION\[|PERMS\[|SECTION_PERMISSION|requireAdmin\(\s*[a-zA-Z_]/.test(b);
    // AI feature routes delegate to the AI pipeline, which enforces the ai:* permission, flags, rollout, consent, safety and audit itself.
    const pipelinePermission = /@\/lib\/ai\/(features|copilot\/copilot)"/.test(src);
    const selfService =/\/api\/admin\/(auth\/(change-password|reauth)|notification-inbox|view-as\/end|admin-sessions\/\[id\]\/revoke)/.test(path);
    if (guard === "admin" && !permission && !inlinePermission && pipelinePermission) notes.push("permission enforced inside the AI pipeline");
    else if (guard === "admin" && !permission && !inlinePermission) {
      if (selfService) notes.push("self-service admin route (acts on the caller's own record)");
      else { notes.push("requireAdmin() without a permission and no inline permission check: any administrator passes"); bump(mutating ? "MEDIUM" : "LOW"); }
    }
    if (mutating && guard !== "none") {
      const audited = /writeAudit\(|logSocAccess\(|socAudit\(|auditMarketing|auditAnalytics|recordApprovalEvent|logPrivacyAccess|logCommunication|writeAuditEvent|audit[A-Z][A-Za-z]*\(|publishSecurityEvent\(/.test(b);
      if (!audited) notes.push("info: no audit call visible in the handler (usually inside the service it calls)");
      const validated = /z\.object|\.parse\(|safeParse|readBody\(|readJson\(|requireReason\(|str\(b,|schema|validate[A-Z]/.test(b);
      if (!validated) notes.push("info: no visible input validation in the handler");
    }
    if (!/try\s*\{/.test(b) && !/withRequestMetrics\(|handlers\.|createRoute|wrap/.test(b)) { notes.push("no try/catch: an exception may reach the framework error page"); bump(guard === "none" ? "MEDIUM" : "LOW"); }
    if (/NextResponse\.json\([^)]*\b(error|e|err)\.(message|stack)/.test(b) && !/instanceof|ApiError|HttpError|handleApiError|marketingError|isKnown/.test(b)) { notes.push("returns a raw error.message/stack without a known-error guard"); bump("MEDIUM"); }
    if (/\b(error|e|err)\.stack\b/.test(b) && /NextResponse/.test(b)) { notes.push("stack trace near a response"); bump("HIGH"); }
    // Ownership (IDOR) heuristics: a handler that takes an identifier from the URL must tie it to the caller somewhere.
    const usesParams = /\bparams\b/.test(b) || /\[[A-Za-z]+\]/.test(path);
    if (usesParams && (guard === "applicant" || guard === "family")) {
      const actorVar = (b.match(/const\s+(\w+)\s*=\s*await\s+(?:requireApplicantProfileId|requireFamilyMemberId)\(/) || [])[1];
      if (actorVar) {
        const uses = (b.match(new RegExp("\\b" + actorVar + "\\b", "g")) || []).length;
        const scopedByService = /requireOwned|assertOwn|ownedBy|belongsTo|forProfile|forMember/.test(b);
        if (uses <= 2 && !scopedByService) { notes.push("IDOR check: the URL identifier is used but the caller id appears only in the guard (" + actorVar + ")"); bump("MEDIUM"); }
      }
    }
    if (usesParams && guard === "admin" && /\/api\/admin\/(profiles|proposals|cases|contact|my-)/.test(path)) {
      const accessCheck = /assert[A-Z]\w*Access|canAccess|requireProfileAccess|assertCan|accessLevel|assignment|AssignedTo|getAccessible|visibleProfile|profileAccess|loadProfile|ensure[A-Z]\w*/.test(b + src);
      if (!accessCheck) { notes.push("assignment check: admin handler on an applicant record shows no assignment/access check"); bump("LOW"); }
    }
    if (/\$queryRawUnsafe|\$executeRawUnsafe/.test(b)) { notes.push("raw SQL (unsafe variant)"); bump("HIGH"); }
    if (/console\.(log|info|debug)\(/.test(b)) { notes.push("console logging in the handler"); bump("LOW"); }
    rows.push({ path, method: h.method, guard, permission, mutating, notes, severity });
  }
}

const bySeverity = (s) => rows.filter((r) => r.severity === s);
const summary = {
  routes: new Set(rows.map((r) => r.path)).size,
  handlers: rows.length,
  guards: rows.reduce((a, r) => ((a[r.guard] = (a[r.guard] || 0) + 1), a), {}),
  severities: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "OK"].reduce((a, s) => ((a[s] = bySeverity(s).length), a), {}),
  adminHandlersWithoutPermission: rows.filter((r) => r.guard === "admin" && !r.permission).length,
};

if (asJson) {
  console.log(JSON.stringify({ summary, findings: rows.filter((r) => r.severity !== "OK") }, null, 1));
} else {
  console.log("STEP 33 route audit —", JSON.stringify(summary));
  for (const sev of ["CRITICAL", "HIGH", "MEDIUM"]) {
    const list = bySeverity(sev);
    if (!list.length) continue;
    console.log(`\n== ${sev} (${list.length}) ==`);
    for (const r of list.slice(0, 80)) console.log(`${r.method.padEnd(6)} ${r.path}  [guard=${r.guard}${r.permission ? ":" + r.permission : ""}]  ${r.notes.join("; ")}`);
    if (list.length > 80) console.log(`… ${list.length - 80} more`);
  }
}
if (failOnHigh && (summary.severities.CRITICAL || summary.severities.HIGH)) process.exit(1);
