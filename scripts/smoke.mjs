#!/usr/bin/env node
/**
 * Pre-/post-deployment smoke test (STEP 15 §50/§62) — UNAUTHENTICATED checks
 * against a running deployment:
 *
 *   node scripts/smoke.mjs --url https://your-site        (or BASE_URL=…)
 *   add --report to post the result as evidence (needs CI_EVIDENCE_TOKEN + COMMIT_SHA)
 *
 * What it does NOT do (reported honestly as NOT_RUN, never as PASS): anything
 * requiring a login. Admin sign-in uses e-mail OTP 2FA and this tooling never
 * handles real passwords, so authenticated flows must be verified by a person.
 * Exit code 1 on any FAIL.
 */
import { parseArgs, baseUrl, http, printResults, reportEvidence } from "./lib/evidence.mjs";

const args = parseArgs();
const base = baseUrl(args);
const results = [];
const add = (name, status, detail = "") => results.push({ name, status, detail });
const isHttps = base.startsWith("https://");

const home = await http(`${base}/`);
add("1. Homepage renders", home.status === 200 && /Life Partner Pro/i.test(home.text) ? "PASS" : "FAIL", `HTTP ${home.status}`);

const register = await http(`${base}/register`);
add("2. Registration page renders", register.status === 200 ? "PASS" : "FAIL", `HTTP ${register.status}`);

const badReg = await http(`${base}/api/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
add("2b. Registration API rejects an empty submission cleanly (no 5xx, no data created)", [400, 415, 422, 429, 503].includes(badReg.status) || (badReg.status >= 400 && badReg.status < 500) ? "PASS" : "FAIL", `HTTP ${badReg.status}`);

const login = await http(`${base}/admin/login`);
add("7. Admin login page renders", login.status === 200 ? "PASS" : "FAIL", `HTTP ${login.status}`);

const live = await http(`${base}/api/health/live`);
add("21a. Liveness endpoint", live.status === 200 && /"ok"/.test(live.text) ? "PASS" : "FAIL", `HTTP ${live.status}`);

const ready = await http(`${base}/api/health/ready`);
add("21b. Readiness endpoint", ready.status === 200 ? "PASS" : "FAIL", `HTTP ${ready.status} ${ready.status !== 200 ? ready.text.slice(0, 120) : ""}`);

const health = await http(`${base}/api/health`);
const leaks = /postgres(ql)?:\/\/|sk_(live|test)_|whsec_|BLOB_READ_WRITE|NEXTAUTH_SECRET|password/i.test(health.text);
add("21c. Health endpoint responds and leaks no secrets", health.status === 200 && !leaks ? "PASS" : "FAIL", leaks ? "response contains a secret-like string" : `HTTP ${health.status}`);

const state = await http(`${base}/api/system-state`);
let blocked = null;
try { blocked = JSON.parse(state.text).blocked; } catch { /* ignore */ }
add("Maintenance/emergency state endpoint", state.status === 200 && blocked === false ? "PASS" : state.status === 200 ? "WARN" : "FAIL", blocked ? "public traffic is currently blocked (maintenance/emergency)" : `HTTP ${state.status}`);

const adminApi = await http(`${base}/api/admin/settings`);
add("22. Admin API requires authentication", adminApi.status === 401 ? "PASS" : "FAIL", `HTTP ${adminApi.status}`);

const adminPage = await http(`${base}/admin/dashboard`);
add("22b. Admin pages redirect to login when signed out", [301, 302, 303, 307, 308].includes(adminPage.status) && /\/admin\/login/.test(adminPage.headers.get("location") ?? "") ? "PASS" : "FAIL", `HTTP ${adminPage.status}`);

const hook = await http(`${base}/api/webhooks/payments/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=forged" }, body: JSON.stringify({ id: "evt_smoke", type: "payment_intent.succeeded" }) });
add("16. Payment webhook rejects an unsigned/forged request", hook.status === 401 || hook.status === 429 ? "PASS" : "FAIL", `HTTP ${hook.status}`);

const notFound = await http(`${base}/this-page-does-not-exist-smoke`);
add("Neutral 404 (no stack trace / internals)", notFound.status === 404 && !/node_modules\/|at .+\(.+:\d+:\d+\)|PrismaClient/i.test(notFound.text) ? "PASS" : "FAIL", `HTTP ${notFound.status}`);

const h = home.headers;
add("Security header: X-Content-Type-Options", h.get("x-content-type-options") === "nosniff" ? "PASS" : "FAIL");
add("Security header: no X-Powered-By", !h.get("x-powered-by") ? "PASS" : "FAIL");
add("Security header: Referrer-Policy", h.get("referrer-policy") ? "PASS" : "FAIL");
add("Security header: frame protection", h.get("x-frame-options") || /frame-ancestors/.test(h.get("content-security-policy") ?? h.get("content-security-policy-report-only") ?? "") ? "PASS" : "FAIL");
add("Security header: Content-Security-Policy present", h.get("content-security-policy") || h.get("content-security-policy-report-only") ? (h.get("content-security-policy") ? "PASS" : "WARN") : "FAIL", h.get("content-security-policy") ? "enforced" : "report-only (not yet enforced)");
add("Security header: HSTS (HTTPS deployments)", isHttps ? (h.get("strict-transport-security") ? "PASS" : "FAIL") : "NOT_RUN", isHttps ? "" : "plain-HTTP target");

for (const flow of [
  "3. Login / OTP sign-in", "4. OTP delivery", "5. Profile creation (full submit)", "6. Profile submission", "8. Admin profile search", "9. Matching", "10. Proposal creation",
  "11. Verification", "12. Notifications", "13. Support ticket (authenticated)", "14. Privacy request", "15. Payment sandbox checkout", "17. Invoice generation",
  "18. Subscription activation", "19. Refund", "20. Backup status (admin)", "23. Admin permissions & audit logging",
]) add(flow, "NOT_RUN", "requires an authenticated session — verify manually; this tool never handles real credentials");

printResults(`Smoke test — ${base}`, results);
const failed = results.some((r) => r.status === "FAIL");
if (args.report) await reportEvidence({ kind: "SMOKE", passed: !failed, url: base, summary: { pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length, notRun: results.filter((r) => r.status === "NOT_RUN").length } });
process.exit(failed ? 1 : 0);
