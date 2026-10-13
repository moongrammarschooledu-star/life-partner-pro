import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it, vi } from "vitest";
import { ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, type AdminRole } from "@/lib/permissions";
import { APPROVAL_CATALOG } from "@/lib/approvals/catalog";
import { KNOWN_LIMITS } from "@/lib/security/rate-limit-policy";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.setConfig({ testTimeout: 60_000 });

// STEP 37 — security checks done on the source and the permission tables: every mobile route is guarded, no token ever leaves the server, push is fail-open and
// lazy, the association files claim only what is configured, the mobile permissions are sensitive and unavailable to staff, and no mobile code can run SQL,
// a shell, or log a credential.

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
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const API = join(SRC, "app", "api");
const mobileRoutes = walk(join(API, "mobile")).filter((p) => p.endsWith("route.ts"));
const adminMobileRoutes = walk(join(API, "admin", "platform", "mobile")).filter((p) => p.endsWith("route.ts"));
const wellKnown = walk(join(SRC, "app", ".well-known")).filter((p) => p.endsWith("route.ts"));
const mobileLib = walk(join(SRC, "lib", "mobile")).filter((p) => /\.ts$/.test(p) && !p.endsWith(".test.ts"));
const PUBLIC_MOBILE = ["version/route.ts", "config/route.ts", "events/route.ts", "deep-link/resolve/route.ts"];

describe("mobile routes are guarded", () => {
  it("there are routes to check", () => {
    expect(mobileRoutes.length).toBeGreaterThanOrEqual(9);
    expect(adminMobileRoutes.length).toBeGreaterThanOrEqual(6);
    expect(wellKnown.length).toBe(2);
  });
  it("a signed-in mobile route uses the mobile guard; a public one is rate limited and on the reviewed list", () => {
    for (const r of mobileRoutes) {
      const src = code(r);
      const isPublic = PUBLIC_MOBILE.some((p) => rel(r).endsWith(p));
      if (isPublic) expect(src, rel(r)).toMatch(/enforceConfiguredLimit\(/);
      else expect(src, rel(r)).toMatch(/mobileGuard\(/);
    }
  });
  it("every state-changing mobile route that relies on the cookie session is same-origin only", () => {
    for (const r of mobileRoutes) {
      const src = code(r);
      if (!/export async function (POST|PATCH|PUT|DELETE)/.test(src)) continue;
      expect(src, rel(r)).toMatch(/write: true|isSameOrigin\(/);
    }
  });
  it("the mobile guard checks the switch, the origin, the session and the rate limit, in that order, and answers one neutral 401", () => {
    const src = code(join(SRC, "lib", "mobile", "route-guard.ts"));
    const order = ["mobile.app.enabled", "isSameOrigin(", "requireMobileActor(", "enforceConfiguredLimit("].map((s) => src.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(src).toMatch(/Not signed in/);
  });
  it("administrator mobile routes name a platform:mobile permission, re-confirm the password for changes, and never take the actor from the request", () => {
    for (const r of adminMobileRoutes) {
      const src = code(r);
      expect(src, rel(r)).toMatch(/requireAdmin\(\s*"platform:mobile:(view|manage|push)"\s*\)/);
      expect(src, rel(r)).not.toMatch(/requireAdmin\(\s*\)/);
      expect(src, rel(r)).toMatch(/handleApiError\(error\)/);
      if (/export async function (POST|PATCH|PUT|DELETE)/.test(src)) expect(src, rel(r)).toMatch(/requireReauth\(/);
      expect(src, rel(r)).not.toMatch(/\b(b|body)\??\.(actorId|adminId|createdById|approvedById)\b/);
    }
  });
  it("route files export only HTTP handlers and route config", () => {
    const allowed = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|dynamic|revalidate|runtime|maxDuration|fetchCache|preferredRegion)$/;
    for (const r of [...mobileRoutes, ...adminMobileRoutes, ...wellKnown]) for (const m of read(r).matchAll(/^export (?:async function|const|function|let|var|class) (\w+)/gm)) expect(m[1], rel(r)).toMatch(allowed);
  });
  it("the rate limit policies the routes use are registered", () => {
    for (const name of ["mobile-public", "mobile-device", "mobile-push-test", "mobile-deep-link", "mobile-events", "mobile-admin-push-test"]) expect(KNOWN_LIMITS[name], name).toBeTruthy();
    for (const r of [...mobileRoutes, ...adminMobileRoutes]) for (const m of code(r).matchAll(/"(mobile-[a-z-]+)"/g)) expect(KNOWN_LIMITS[m[1]], `${rel(r)} ${m[1]}`).toBeTruthy();
  });
});

describe("push tokens never leave the server", () => {
  it("no route file reads or returns a token column", () => {
    for (const r of [...mobileRoutes, ...adminMobileRoutes]) expect(code(r), rel(r)).not.toMatch(/pushTokenEnc|pushTokenHash|decryptPushToken|tokenOf\(/);
  });
  it("only the device, push and admin services touch the encrypted token, and the admin view only reports whether one exists", () => {
    const allowed = new Set(["lib/mobile/device-service.ts", "lib/mobile/push-service.ts", "lib/mobile/admin-service.ts", "lib/mobile/token-crypto.ts"]);
    for (const f of walk(SRC).filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts"))) if (/pushTokenEnc|decryptPushToken/.test(code(f))) expect(allowed.has(rel(f)), rel(f)).toBe(true);
    expect(code(join(SRC, "lib", "mobile", "admin-service.ts"))).toMatch(/\.\.\.r, pushEnabled: !!pushTokenEnc/);
  });
  it("mobile code never logs, and builds no URL or log line from a credential", () => {
    for (const f of mobileLib) {
      const src = code(f);
      expect(src, rel(f)).not.toMatch(/console\.(log|info|warn|error|debug)\(/);
      expect(src, rel(f)).not.toMatch(/logger\.[a-z]+\([^)]*(token|privateKey|secret)/i);
    }
  });
  it("the device view type has no token, installation id, owner id or session id", () => {
    const src = code(join(SRC, "lib", "mobile", "device-service.ts"));
    const view = /export type DeviceView = \{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
    expect(view).toBeTruthy();
    expect(view).not.toMatch(/token|installationId|profileId|familyMemberId|sessionId/i);
  });
});

describe("no SQL, shell or arbitrary execution in the mobile layer", () => {
  it("none of the mobile code runs raw SQL, a shell, eval or sets HTML", () => {
    for (const f of [...mobileLib, ...mobileRoutes, ...adminMobileRoutes, ...wellKnown]) {
      const src = code(f);
      expect(src, rel(f)).not.toMatch(/\$queryRaw|\$executeRaw|child_process|execSync|spawnSync|\beval\(|new Function\(|dangerouslySetInnerHTML/);
    }
  });
  it("mobile services do not import the AI, payment or matching engines (the apps reuse the existing backend; they do not duplicate it)", () => {
    for (const f of mobileLib) expect(code(f), rel(f)).not.toMatch(/from "@\/lib\/(ai|finance|matching|crm|promotions|referrals)\b/);
  });
});

describe("push is best effort", () => {
  it("the notification service loads push on demand and swallows a push failure", () => {
    const src = code(join(SRC, "lib", "notifications", "notification-service.ts"));
    expect(src).toMatch(/await import\("@\/lib\/mobile\/push-service"\)/);
    const block = /if \(created && \(profileId \|\| familyMemberId\)\) \{([\s\S]*?)\r?\n    \}\r?\n/.exec(src)?.[1] ?? "";
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/catch/);
    expect(src).not.toMatch(/^import .* from "@\/lib\/mobile\//m);
  });
  it("the dispatcher is gated by the three switches, never throws, and holds back marketing", () => {
    const src = code(join(SRC, "lib", "mobile", "push-service.ts"));
    for (const f of ["mobile.push.enabled", "mobile.app.enabled", "notifications.enabled"]) expect(src).toContain(f);
    expect(src).toMatch(/isPushableCategory\(/);
    expect(src).toMatch(/\} catch \{\s*return summary;/);
  });
});

describe("app association files", () => {
  it("assetlinks.json is an empty list until signing fingerprints are configured, then names only the configured package and fingerprints", async () => {
    const { GET } = await import("@/app/.well-known/assetlinks.json/route");
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", "");
    expect(await (await GET()).json()).toEqual([]);
    const fp = Array.from({ length: 32 }, (_, i) => (i + 10).toString(16).toUpperCase().padStart(2, "0")).join(":");
    vi.stubEnv("ANDROID_SHA256_CERT_FINGERPRINTS", fp);
    vi.stubEnv("ANDROID_PACKAGE_ID", "com.example.published");
    const body = await (await GET()).json();
    expect(body).toEqual([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.example.published", sha256_cert_fingerprints: [fp] } }]);
    vi.unstubAllEnvs();
  });
  it("apple-app-site-association lists no app until a Team ID is configured, then only the approved routes (no wildcard)", async () => {
    const { GET } = await import("@/app/.well-known/apple-app-site-association/route");
    vi.stubEnv("APPLE_TEAM_ID", "");
    vi.stubEnv("APNS_TEAM_ID", "");
    const empty = await (await GET()).json();
    expect(empty).toEqual({ applinks: { details: [] } });
    vi.stubEnv("APPLE_TEAM_ID", "ABCDE12345");
    vi.stubEnv("IOS_BUNDLE_ID", "com.example.published");
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.applinks.details[0].appIDs).toEqual(["ABCDE12345.com.example.published"]);
    const paths = body.applinks.details[0].components.map((c: { "/": string }) => c["/"]);
    expect(paths).not.toContain("*");
    expect(paths).not.toContain("/*");
    expect(paths).toContain("/dashboard");
    for (const p of paths) expect(p).not.toMatch(/admin|api/);
    vi.unstubAllEnvs();
  });
  it("neither file reads the database or needs a session", () => {
    for (const r of wellKnown) expect(code(r), rel(r)).not.toMatch(/prisma|requireAdmin|requireMobileActor|cookies\(/);
  });
});

describe("purchases from inside the app", () => {
  it("a membership checkout started from the app is refused while mobile.payments.enabled is off, before any order is created", () => {
    const src = code(join(API, "my-billing", "checkout", "route.ts"));
    const gate = src.indexOf("mobile.payments.enabled");
    expect(gate).toBeGreaterThan(0);
    expect(src).toMatch(/parseAppUserAgent\(/);
    expect(gate).toBeLessThan(src.indexOf("startCheckout({"));
  });
  it("the app never decides entitlements: no mobile module imports the membership or payment code", () => {
    for (const f of mobileLib) expect(code(f), rel(f)).not.toMatch(/entitlement|from "@\/lib\/finance/i);
  });
});

describe("permissions, approval and flags", () => {
  const mobilePerms = (role: AdminRole) => (ROLE_PERMISSIONS[role] as string[]).filter((p) => p.startsWith("platform:mobile:"));
  it("only SUPER_ADMIN manages or pushes; operations only views; staff roles hold nothing", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as AdminRole[]) {
      const p = mobilePerms(role);
      if (role === "SUPER_ADMIN") expect(p.sort()).toEqual(["platform:mobile:manage", "platform:mobile:push", "platform:mobile:view"]);
      else if (role === "OPERATIONS_ADMIN") expect(p).toEqual(["platform:mobile:view"]);
      else expect(p, role).toEqual([]);
    }
  });
  it("manage and push are sensitive permissions", () => {
    for (const p of ["platform:mobile:manage", "platform:mobile:push"]) expect(SENSITIVE_PERMISSIONS).toContain(p);
  });
  it("moving a release to production has its own approval action, for SUPER_ADMIN only", () => {
    expect(APPROVAL_CATALOG.MOBILE_PRODUCTION_RELEASE).toMatchObject({ domain: "PLATFORM", defaultAllowedRoles: ["SUPER_ADMIN"] });
    expect(code(join(SRC, "lib", "mobile", "release-service.ts"))).toContain("MOBILE_PRODUCTION_RELEASE");
  });
});
