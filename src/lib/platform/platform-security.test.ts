import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it, vi } from "vitest";
import { ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, type AdminRole } from "@/lib/permissions";
import { APPROVAL_CATALOG } from "@/lib/approvals/catalog";
import { SETTING_DEFS } from "./settings-registry";
import { KNOWN_LIMITS } from "@/lib/security/rate-limit-policy";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// STEP 36 — security tests done on the source and on the permission tables: every Control Center route is guarded, only handlers are exported, the request can
// never name the person acting, there is no SQL console / shell / secret reader, staff roles hold nothing, and the sensitive actions are marked sensitive.

vi.setConfig({ testTimeout: 60_000 }); // some checks read the whole source tree

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
const platformRoutes = [...walk(join(API, "admin", "platform")), ...walk(join(API, "admin", "control-center"))].filter((p) => p.endsWith("route.ts"));
const platformLib = walk(join(SRC, "lib", "platform")).filter((p) => /\.ts$/.test(p) && !p.endsWith(".test.ts"));
const platformUi = walk(join(SRC, "components", "admin", "platform"));

// Routes that call requireAdmin() bare because the permission depends on WHAT is being changed; the service re-checks it. Nothing else may.
const BARE_ALLOWED: Record<string, string> = {
  "app/api/admin/platform/settings/route.ts": "lib/platform/settings.ts",
  "app/api/admin/platform/settings/[key]/route.ts": "lib/platform/settings.ts",
  "app/api/admin/platform/kill-switches/route.ts": "lib/platform/killswitch.ts",
};

describe("every Control Center route is guarded", () => {
  it("there are routes to check", () => {
    expect(platformRoutes.length).toBeGreaterThanOrEqual(20);
  });

  it("authorises with requireAdmin(<platform permission>); a bare requireAdmin() is allowed only where the service re-checks", () => {
    for (const r of platformRoutes) {
      const src = code(r);
      const bare = /requireAdmin\(\s*\)/.test(src);
      if (bare) {
        const service = BARE_ALLOWED[rel(r)];
        expect(service, `${rel(r)} uses a bare requireAdmin()`).toBeTruthy();
        expect(code(join(SRC, service)), service).toMatch(/permissions\.includes\(/);
      } else {
        expect(src, rel(r)).toMatch(/requireAdmin\(\s*"platform:[a-z_:]+"\s*\)/);
      }
    }
  });

  it("every permission a route names exists, is described and is held by SUPER_ADMIN", () => {
    const defs = read(join(SRC, "lib", "permission-defs.ts"));
    const named = new Set<string>();
    for (const r of platformRoutes) for (const m of code(r).matchAll(/requireAdmin\("(platform:[a-z_:]+)"\)/g)) named.add(m[1]);
    expect(named.size).toBeGreaterThanOrEqual(10);
    for (const p of named) {
      expect(defs, p).toContain(`"${p}"`);
      expect(ROLE_PERMISSIONS.SUPER_ADMIN, p).toContain(p);
    }
  });

  it("exports only HTTP handlers and route config, answers errors through the shared handler", () => {
    const allowed = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|dynamic|revalidate|runtime|maxDuration|fetchCache|preferredRegion)$/;
    for (const r of platformRoutes) {
      expect(code(r), rel(r)).toMatch(/handleApiError\(error\)/);
      for (const m of read(r).matchAll(/^export (?:async function|const|function|let|var|class) (\w+)/gm)) expect(m[1], rel(r)).toMatch(allowed);
    }
  });

  it("every state-changing route asks for a fresh password confirmation (or hands that to a service that cannot be skipped)", () => {
    // Announcements are drafted and published as ordinary content: guarded by the manage permission, no password prompt by design.
    const exempt = ["announcements/route.ts", "announcements/[id]/route.ts"];
    for (const r of platformRoutes) {
      const src = code(r);
      if (!/export async function (POST|PATCH|PUT|DELETE)/.test(src)) continue;
      if (exempt.some((e) => rel(r).endsWith(e))) continue;
      if (/providers\/\[id\]\/test/.test(rel(r))) continue; // read-only connection test, rate limited
      expect(src, rel(r)).toMatch(/requireReauth\(/);
    }
  });

  it("never lets the request name the person acting", () => {
    for (const r of platformRoutes) expect(code(r), rel(r)).not.toMatch(/\b(b|body)\??\.(actorId|adminId|createdById|updatedById|reviewerId|reviewedById|approvedById|authorId)\b/);
  });

  it("the provider test and the export are rate limited, with registered policies", () => {
    expect(KNOWN_LIMITS["platform-provider-test"]).toBeTruthy();
    expect(KNOWN_LIMITS["platform-export"]).toBeTruthy();
    expect(code(join(API, "admin", "platform", "providers", "[id]", "test", "route.ts"))).toMatch(/enforceConfiguredLimit\(req, "platform-provider-test"/);
    expect(code(join(API, "admin", "platform", "export", "route.ts"))).toMatch(/enforceConfiguredLimit\(req, "platform-export"/);
  });

  it("the older flag and control routes also honour the change freeze and the history", () => {
    expect(code(join(API, "admin", "system", "flags", "route.ts"))).toMatch(/applyLegacyFlagToggle|applyFlagChange/);
    expect(code(join(API, "admin", "system", "control", "route.ts"))).toMatch(/assertNotFrozen|assertConfigChangeAllowed/);
  });
});

describe("the public status endpoint", () => {
  it("is public, read-only and goes through the status builder only", () => {
    const src = code(join(API, "status", "route.ts"));
    expect(src).not.toMatch(/requireAdmin|prisma|process\.env/);
    expect(src).toMatch(/getPublicStatus\(/);
    expect(src).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)/);
  });
});

describe("no SQL console, shell, secret reader or arbitrary code", () => {
  const files = [...platformLib, ...platformRoutes, ...platformUi];
  it("the Control Center never runs raw SQL, a shell, eval or a dynamic function", () => {
    for (const f of files) {
      const src = code(f);
      expect(src, rel(f)).not.toMatch(/\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
      expect(src, rel(f)).not.toMatch(/child_process|execSync|spawnSync|\bexec\(|\bspawn\(/);
      expect(src, rel(f)).not.toMatch(/\beval\(|new Function\(/);
      expect(src, rel(f)).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
  it("no screen or route reads environment values: only the environment name and the presence of provider settings", () => {
    for (const f of [...platformRoutes, ...platformUi]) expect(code(f), rel(f)).not.toMatch(/process\.env/);
    const allowedEnvUsers = new Set(["lib/platform/environment-core.ts", "lib/platform/environment.ts", "lib/platform/providers.ts"]);
    for (const f of platformLib) if (/process\.env/.test(code(f))) expect(allowedEnvUsers.has(rel(f)), rel(f)).toBe(true);
  });
  it("provider code only checks that a setting is present; it never returns the value", () => {
    const src = code(join(SRC, "lib", "platform", "providers.ts"));
    // The only way env is read is the presence helper, which returns a boolean.
    expect(src).toMatch(/const present = \(name: string[^)]*\) => name\.split\("\|"\)\.some\(\(alt\) => Boolean\(env\[alt\]\?\.trim\(\)\)\)/);
    // The one direct read is the Stripe key sent as the Authorization header of a read-only balance request; it is never placed in a returned value.
    const direct = [...src.matchAll(/process\.env\.[A-Z_]+/g)];
    expect(direct.length).toBeLessThanOrEqual(1);
    for (const m of direct) expect(src.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0)).toContain("Bearer");
  });
  it("the settings registry holds no secret type and none of the domains that have their own editors", () => {
    for (const d of SETTING_DEFS) {
      expect(d.type, d.key).not.toBe("SECRET_REFERENCE");
      expect(d.key, d.key).not.toMatch(/^(payment|security|auth|matching|verification|privacy|retention|risk|ai|proposal|workflow)\./);
      expect(d.key, d.key).not.toMatch(/secret|password|token|api_?key/i);
    }
  });
});

describe("the permission model", () => {
  const platformPerms = (role: AdminRole) => (ROLE_PERMISSIONS[role] as string[]).filter((p) => p.startsWith("platform:"));
  it("only SUPER_ADMIN, OPERATIONS_ADMIN and COMPLIANCE_MANAGER hold any platform permission, and the last two only to view", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as AdminRole[]) {
      const p = platformPerms(role);
      if (role === "SUPER_ADMIN") expect(p.length).toBe(23);
      else if (role === "OPERATIONS_ADMIN" || role === "COMPLIANCE_MANAGER") {
        expect(p.length, role).toBeGreaterThan(0);
        for (const x of p) expect(x, `${role} ${x}`).toMatch(/:view$/);
      } else expect(p, role).toEqual([]);
    }
  });
  it("break-glass, change freeze, rollback, provider and setting changes are sensitive", () => {
    for (const p of ["platform:break_glass", "platform:change_freeze", "platform:configuration:rollback", "platform:providers:manage", "platform:settings:manage"]) expect(SENSITIVE_PERMISSIONS, p).toContain(p);
  });
  it("the three platform approval actions exist in the catalogue, in the PLATFORM domain, for SUPER_ADMIN only", () => {
    for (const k of ["PLATFORM_FEATURE_ACTIVATION", "PLATFORM_SETTING_HIGH_RISK", "PLATFORM_CONFIG_ROLLBACK"]) {
      expect(APPROVAL_CATALOG[k], k).toBeTruthy();
      expect(APPROVAL_CATALOG[k].domain).toBe("PLATFORM");
      expect(APPROVAL_CATALOG[k].defaultAllowedRoles).toEqual(["SUPER_ADMIN"]);
    }
    const used = platformLib.map((f) => code(f)).join("\n");
    for (const k of ["PLATFORM_FEATURE_ACTIVATION", "PLATFORM_SETTING_HIGH_RISK", "PLATFORM_CONFIG_ROLLBACK"]) expect(used, k).toContain(k);
  });
});

describe("the change log cannot be rewritten", () => {
  it("nothing updates or deletes a PlatformConfigChange row", () => {
    for (const f of walk(SRC).filter((p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".test.ts"))) {
      expect(code(f), rel(f)).not.toMatch(/platformConfigChange\.(update|updateMany|delete|deleteMany|upsert)\(/);
    }
  });
  it("only the change-log module writes it", () => {
    for (const f of platformLib) if (rel(f) !== "lib/platform/config-change.ts") expect(code(f), rel(f)).not.toMatch(/platformConfigChange\.create/);
  });
});
