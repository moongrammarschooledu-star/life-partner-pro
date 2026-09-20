import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

// Static authorization-coverage guard (STEP 15 §43/§51). Every API route must
// either enforce authentication in its own file or appear in an explicit,
// reviewed allowlist of intentionally-public routes. A NEW route that does
// neither fails this test — so an accidentally unauthenticated endpoint (the
// root cause of most IDOR / broken-access-control bugs) can't ship silently.
// This proves the presence of a check, not its correctness; the live
// unauthorized-access matrix (scripts/security-smoke.mjs) covers behavior.

const API_ROOT = join(process.cwd(), "src", "app", "api");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

const routes = walk(API_ROOT).map((file) => ({
  path: "/api/" + relative(API_ROOT, file).split(sep).slice(0, -1).join("/"),
  source: readFileSync(file, "utf8"),
}));

// Admin routes that are public BY DESIGN (the pre-authentication login flow).
const PUBLIC_ADMIN = new Set(["/api/admin/auth/precheck", "/api/admin/auth/verify-otp"]);

// Reviewed exception: uses auth() directly because requireAdmin() deliberately
// refuses requests while View-As is active, and this endpoint is what tells the
// UI that View-As IS active. It still requires a session (returns nothing else).
const SESSION_ONLY_ADMIN = new Set(["/api/admin/view-as/status"]);

// Non-admin routes that are intentionally reachable without a session. Each
// has its own protection (rate limit, signature, secret, OTP, honeypot…).
const PUBLIC_ROUTES = new Set([
  "/api/register", "/api/support", "/api/update-request", "/api/my-status",
  "/api/verify/email/send", "/api/verify/email/confirm", "/api/verify/phone/send", "/api/verify/phone/confirm",
  "/api/health", "/api/health/live", "/api/health/ready", "/api/system-state", "/api/client-errors",
  "/api/webhooks/payments/[provider]", "/api/webhooks/notifications",
  "/api/cron/notifications", "/api/internal/ci-evidence",
  "/api/auth/[...nextauth]",
  "/api/my-billing/packages", // public package catalogue (no personal data)
]);

const APPLICANT_AUTH = /requireApplicantProfileId\(|verifyProfileToken\(/;
const ADMIN_AUTH = /requireAdmin\(/;

describe("API route authorization coverage", () => {
  it("finds the route tree (sanity)", () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it("every /api/admin route calls requireAdmin (except the login flow)", () => {
    const missing = routes.filter((r) => r.path.startsWith("/api/admin/") && !PUBLIC_ADMIN.has(r.path) && !SESSION_ONLY_ADMIN.has(r.path) && !ADMIN_AUTH.test(r.source)).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("session-only admin exceptions still verify the session", () => {
    for (const path of SESSION_ONLY_ADMIN) {
      const route = routes.find((r) => r.path === path);
      expect(route?.source).toMatch(/await auth()/);
    }
  });

  it("every applicant (/api/my-*) route verifies the applicant session", () => {
    const missing = routes.filter((r) => /^\/api\/my-/.test(r.path) && !PUBLIC_ROUTES.has(r.path) && !APPLICANT_AUTH.test(r.source)).map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it("no other route is public unless it is on the reviewed allowlist", () => {
    const unexpected = routes
      .filter((r) => !r.path.startsWith("/api/admin/") && !/^\/api\/my-/.test(r.path))
      .filter((r) => !PUBLIC_ROUTES.has(r.path))
      .map((r) => r.path);
    expect(unexpected).toEqual([]);
  });

  it("every allowlisted public route still exists (stale entries are removed)", () => {
    const existing = new Set(routes.map((r) => r.path));
    const stale = [...PUBLIC_ROUTES, ...PUBLIC_ADMIN].filter((p) => !existing.has(p));
    expect(stale).toEqual([]);
  });

  it("public state-changing routes are rate-limited or secret/signature protected", () => {
    const protectedBy = /rateLimit\(|enforcePersistentLimit\(|rateLimitPersistent\(|verifyWebhook\(|CRON_SECRET|NOTIFICATION_WEBHOOK_SECRET|CI_EVIDENCE_TOKEN|handlers\.POST/;
    const unprotected = routes
      .filter((r) => PUBLIC_ROUTES.has(r.path) && /export (async function|const) POST|export const \{[^}]*POST/.test(r.source))
      .filter((r) => !protectedBy.test(r.source))
      .map((r) => r.path);
    expect(unprotected).toEqual([]);
  });
});
