#!/usr/bin/env node
/**
 * Live security smoke test (STEP 15 §51) — unauthenticated attack-surface probe.
 *
 *   node scripts/security-smoke.mjs --url https://your-site [--report]
 *
 * Walks the real route tree (src/app/api/**) and proves that every admin and
 * applicant endpoint rejects a caller with no session, that webhooks reject
 * spoofed requests, and that errors/headers do not leak internals. A failing
 * critical check blocks the deployment gate (exit code 1).
 *
 * Deliberately NOT done (reported as NOT_RUN): IDOR / privilege-escalation /
 * staff-assignment / payment- or refund-manipulation checks, which need real
 * sessions for two different users; and probing /api/cron/* (it would EXECUTE
 * the daily tasks if CRON_SECRET were unset — Production Readiness checks that
 * secret's presence instead).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseArgs, baseUrl, http, printResults, reportEvidence } from "./lib/evidence.mjs";

const args = parseArgs();
const base = baseUrl(args);
const results = [];
const add = (name, status, detail = "") => results.push({ name, status, detail });

const API = join(process.cwd(), "src", "app", "api");
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (e === "route.ts") out.push(full);
  }
  return out;
}

const routes = walk(API).map((file) => {
  const src = readFileSync(file, "utf8");
  const path = "/api/" + relative(API, file).split(sep).slice(0, -1).join("/");
  const methods = [...src.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
  return { path, methods: [...new Set(methods)] };
});

const concreteUrl = (path) => base + path.replace(/\[\.\.\.[^\]]+\]/g, "x").replace(/\[[^\]]+\]/g, "smoke-id");

// 1. Every admin API endpoint must reject an anonymous caller.
const PUBLIC_ADMIN = new Set(["/api/admin/auth/precheck", "/api/admin/auth/verify-otp"]);
const adminFailures = [];
let adminChecked = 0;
for (const r of routes.filter((x) => x.path.startsWith("/api/admin/") && !PUBLIC_ADMIN.has(x.path))) {
  for (const method of r.methods) {
    const res = await http(concreteUrl(r.path), { method, headers: method === "GET" ? {} : { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    adminChecked++;
    if (res.status !== 401) adminFailures.push(`${method} ${r.path} → ${res.status}`);
  }
}
add(`Unauthorized API access — ${adminChecked} admin endpoint/method pairs reject anonymous callers (401)`, adminFailures.length === 0 ? "PASS" : "FAIL", adminFailures.slice(0, 8).join("; "));

// 2. Applicant (/api/my-*) endpoints must reject anonymous callers.
const PUBLIC_MY = new Set(["/api/my-status", "/api/my-billing/packages"]);
const applicantFailures = [];
let applicantChecked = 0;
for (const r of routes.filter((x) => /^\/api\/my-/.test(x.path) && !PUBLIC_MY.has(x.path))) {
  for (const method of r.methods) {
    const res = await http(concreteUrl(r.path), { method, headers: method === "GET" ? {} : { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    applicantChecked++;
    if (![401, 403, 429].includes(res.status)) applicantFailures.push(`${method} ${r.path} → ${res.status}`);
  }
}
add(`Unauthorized profile/contact/document/payment access — ${applicantChecked} applicant endpoint/method pairs reject anonymous callers`, applicantFailures.length === 0 ? "PASS" : "FAIL", applicantFailures.slice(0, 8).join("; "));

// 3. Webhook spoofing.
const forged = await http(`${base}/api/webhooks/payments/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=1700000000,v1=00" }, body: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", data: { object: { amount_total: 1 } } }) });
add("Webhook spoofing: forged signature rejected", forged.status === 401 || forged.status === 429 ? "PASS" : "FAIL", `HTTP ${forged.status}`);
const noSig = await http(`${base}/api/webhooks/payments/stripe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
add("Webhook spoofing: missing signature rejected", noSig.status === 401 || noSig.status === 429 ? "PASS" : "FAIL", `HTTP ${noSig.status}`);
const unknown = await http(`${base}/api/webhooks/payments/madeup`, { method: "POST", body: "{}" });
add("Webhook: unknown provider rejected", unknown.status === 404 || unknown.status === 429 ? "PASS" : "FAIL", `HTTP ${unknown.status}`);
const hook2 = await http(`${base}/api/webhooks/notifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "smoke" }) });
add("Notification webhook does not accept unsigned requests", hook2.status === 401 || hook2.status === 429 ? "PASS" : "WARN", hook2.status === 401 ? "" : `HTTP ${hook2.status} — set NOTIFICATION_WEBHOOK_SECRET so unsigned calls are refused`);

// 4. CI evidence endpoint must not be usable without its token.
const ev = await http(`${base}/api/internal/ci-evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "TESTS", status: "PASS", commitSha: "abcdef1" }) });
add("Evidence endpoint refuses unauthenticated evidence", ev.status === 401 || ev.status === 503 ? "PASS" : "FAIL", `HTTP ${ev.status}`);

// 5. Information disclosure.
const malformed = await http(`${base}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
add("Malformed input does not leak stack traces or internals", !/node_modules\/|\bat [\w$.]+ \(|PrismaClient|SELECT |postgres/i.test(malformed.text) && malformed.status < 500 ? "PASS" : "FAIL", `HTTP ${malformed.status}`);
const cors = await http(`${base}/api/health`, { headers: { Origin: "https://evil.example" } });
add("CORS: arbitrary origins are not granted", !cors.headers.get("access-control-allow-origin") || cors.headers.get("access-control-allow-origin") === base ? "PASS" : "FAIL", cors.headers.get("access-control-allow-origin") ?? "");
const method = await http(`${base}/api/register`, { method: "DELETE" });
add("Unsupported HTTP methods are refused", method.status === 405 || method.status === 404 ? "PASS" : "FAIL", `HTTP ${method.status}`);

// 6. Session-fixation / hijack basics: a forged applicant cookie is not accepted.
const forgedCookie = await http(`${base}/api/my-status`, { headers: { Cookie: "lpp_session=someprofile.forgedsignature; lpp_sid=forged" } });
add("Session hijacking: forged applicant session cookie grants nothing", ![200].includes(forgedCookie.status) || !/"profile"|"proposals"/.test(forgedCookie.text) ? "PASS" : "FAIL", `HTTP ${forgedCookie.status}`);

// 7. Rate-limit probe (indicative only — the in-memory limiter is per instance).
let limited = false;
for (let i = 0; i < 8 && !limited; i++) {
  const r = await http(`${base}/api/verify/email/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (r.status === 429) limited = true;
}
add("Rate limiting: repeated anonymous submissions eventually receive 429", limited ? "PASS" : "WARN", limited ? "" : "not triggered — expected on multi-instance hosting where the public limiter is per-instance; admin/sensitive routes use the persistent limiter");

for (const item of ["Unauthorized profile access by ID (IDOR) with two real users", "Privilege escalation between admin roles", "Staff assignment bypass", "Sensitive field bypass", "Payment amount manipulation (authenticated checkout)", "Refund manipulation", "Duplicate payment / duplicate webhook replay with a valid signature", "Session hijacking on real admin sessions"]) {
  add(item, "NOT_RUN", "requires authenticated sessions / provider secrets — covered by unit tests and manual review, not by this tool");
}
add("Cron endpoint authentication", "NOT_RUN", "not probed: would execute the daily tasks if CRON_SECRET were unset; Production Readiness verifies the secret is configured");

printResults(`Security smoke test — ${base}`, results);
const failed = results.some((r) => r.status === "FAIL");
if (args.report) await reportEvidence({ kind: "SECURITY_SMOKE", passed: !failed, url: base, summary: { adminChecked, applicantChecked, fail: results.filter((r) => r.status === "FAIL").length } });
process.exit(failed ? 1 : 0);
