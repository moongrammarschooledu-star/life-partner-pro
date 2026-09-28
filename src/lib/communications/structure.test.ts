import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { ADMIN_ROLES, ROLE_PERMISSIONS, SENSITIVE_PERMISSIONS, hasPermission, type AdminRole, type Permission } from "@/lib/permissions";

// Structural guarantees for STEP 25, checked against the SOURCE TREE so they cannot silently regress:
//   - every communication admin route is permission-guarded, and no state-changing route needs only a "view" permission;
//   - the role matrix separates duties (no support role can manage providers, approve templates or approve campaigns);
//   - there is no route through which one applicant can message another, and no unofficial WhatsApp automation anywhere;
//   - no provider credential is referenced from client code or exposed by a response.

const SRC = join(process.cwd(), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");

// (app/api/admin/communications/route.ts and send/route.ts pre-date STEP 25 and keep their original communication:* permissions.)
const adminCommRoutes = allFiles.filter((f) => rel(f).startsWith("app/api/admin/communications/") && rel(f).endsWith("/route.ts") && rel(f) !== "app/api/admin/communications/route.ts" && !rel(f).startsWith("app/api/admin/communications/send/"));
const PERM = /requireAdmin\(\s*"([^"]+)"/g;

describe("communication admin routes", () => {
  it("finds the route tree (sanity)", () => {
    expect(adminCommRoutes.length).toBeGreaterThan(30);
  });

  it("every handler is guarded by a communications permission that actually exists", () => {
    const all = new Set<string>(Object.values(ROLE_PERMISSIONS).flat());
    for (const f of adminCommRoutes) {
      const perms = [...read(f).matchAll(PERM)].map((m) => m[1]);
      const exports = [...read(f).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
      // one requireAdmin per exported handler
      expect(perms.length, rel(f)).toBeGreaterThanOrEqual(Math.max(exports.length, 1));
      for (const p of perms) {
        expect(p.startsWith("communications:") || p.startsWith("sensitive:communication:"), `${rel(f)} uses ${p}`).toBe(true);
        expect(all.has(p), `${rel(f)} uses an unknown permission ${p}`).toBe(true);
      }
    }
  });

  it("no state-changing handler is protected by a view-only permission", () => {
    for (const f of adminCommRoutes) {
      const src = read(f);
      // split into handlers and check the permission used inside each mutating one
      const parts = src.split(/export async function /).slice(1);
      for (const part of parts) {
        const method = part.slice(0, part.indexOf("("));
        if (method === "GET") continue;
        const perm = part.match(PERM)?.[0]?.match(/"([^"]+)"/)?.[1];
        // "communications:view" and *:view permissions must never authorise a write (the preview endpoints are POST but read-only)
        if (rel(f).endsWith("/preview/route.ts")) continue;
        expect(perm && !perm.endsWith(":view"), `${rel(f)} ${method} uses ${perm}`).toBe(true);
      }
    }
  });

  it("dangerous actions need the manage / approve / activate / suppress permissions", () => {
    const need: Record<string, string> = {
      "providers/route.ts": "communications:providers:manage",
      "providers/[id]/route.ts": "communications:providers:manage",
      "providers/[id]/probe/route.ts": "communications:providers:manage",
      "templates/[id]/approve/route.ts": "communications:templates:approve",
      "templates/[id]/activate/route.ts": "communications:templates:activate",
      "campaigns/[id]/approve/route.ts": "communications:campaigns:approve",
      "campaigns/[id]/start/route.ts": "communications:campaigns:manage",
      "campaigns/[id]/cancel/route.ts": "communications:campaigns:manage",
      "suppressions/[id]/lift/route.ts": "communications:suppress",
      "policies/[kind]/route.ts": "communications:providers:manage",
      "webhooks/simulate/route.ts": "communications:providers:manage",
    };
    for (const [file, perm] of Object.entries(need)) {
      const f = adminCommRoutes.find((x) => rel(x).endsWith(`communications/${file}`));
      expect(f, file).toBeTruthy();
      expect(read(f as string), file).toContain(`requireAdmin("${perm}")`);
    }
  });

  it("CSV export needs the export permission, and the simulator is closed in production", () => {
    const analytics = read(adminCommRoutes.find((f) => rel(f).endsWith("communications/analytics/route.ts")) as string);
    expect(analytics).toContain("communications:export");
    const sim = read(adminCommRoutes.find((f) => rel(f).endsWith("webhooks/simulate/route.ts")) as string);
    expect(sim).toMatch(/production/);
  });
});

describe("role matrix (separation of duties)", () => {
  const has = (role: AdminRole, p: Permission) => hasPermission(role, p);

  it("only super admins and compliance can manage providers; nobody in support or communication roles can", () => {
    for (const role of ["SUPPORT_STAFF", "SUPPORT_MANAGER", "COMMUNICATION_STAFF", "COMMUNICATION_MANAGER", "OPERATIONS_ADMIN"] as AdminRole[]) {
      expect(has(role, "communications:providers:manage" as Permission), role).toBe(false);
    }
    expect(has("SUPER_ADMIN", "communications:providers:manage" as Permission)).toBe(true);
    expect(has("COMPLIANCE_MANAGER", "communications:providers:manage" as Permission)).toBe(true);
  });

  it("frontline roles can send and view but not approve, activate or run campaigns", () => {
    for (const role of ["SUPPORT_STAFF", "COMMUNICATION_STAFF"] as AdminRole[]) {
      for (const p of ["communications:templates:approve", "communications:templates:activate", "communications:campaigns:approve", "communications:campaigns:manage", "communications:export", "sensitive:communication:view"]) {
        expect(has(role, p as Permission), `${role} ${p}`).toBe(false);
      }
    }
    expect(has("SUPPORT_STAFF", "communications:send" as Permission)).toBe(true);
  });

  it("the sensitive communication permissions are classified as sensitive", () => {
    expect(SENSITIVE_PERMISSIONS).toContain("sensitive:communication:view");
    expect(SENSITIVE_PERMISSIONS).toContain("sensitive:communication:send");
  });

  it("read-only and finance-style roles gain no communication write access", () => {
    for (const role of ADMIN_ROLES) {
      if (["SUPER_ADMIN", "COMPLIANCE_MANAGER", "COMMUNICATION_MANAGER", "COMMUNICATION_STAFF", "SUPPORT_STAFF", "SUPPORT_MANAGER", "OPERATIONS_ADMIN", "ADMIN"].includes(role)) continue;
      for (const p of ["communications:send", "communications:bulk", "communications:providers:manage", "communications:campaigns:create", "communications:suppress"]) {
        expect(has(role, p as Permission), `${role} ${p}`).toBe(false);
      }
    }
  });
});

describe("no applicant-to-applicant messaging", () => {
  const apiFiles = allFiles.filter((f) => rel(f).startsWith("app/api/"));

  it("no applicant / family route accepts a recipient, and only the applicant's own thread can be replied to", () => {
    const own = apiFiles.filter((f) => rel(f).startsWith("app/api/my-communications") || rel(f).startsWith("app/api/family/communications"));
    expect(own.length).toBeGreaterThanOrEqual(4);
    for (const f of own) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/recipient(Profile)?Id|toProfileId|targetProfileId|otherProfileId|familyMemberId\s*[:=]\s*body/);
      expect(src, rel(f)).toMatch(/requireApplicantProfileId\(|requireFamilyMemberId\(/);
    }
    // the ONLY applicant write is a reply into an existing thread they belong to
    const post = own.filter((f) => /export async function POST/.test(read(f)));
    expect(post.map(rel)).toEqual(["app/api/my-communications/[id]/route.ts"]);
  });

  it("the thread model can hold at most one applicant: creation adds exactly one PROFILE member and no thread type joins two", () => {
    const src = read(join(SRC, "lib/communications/thread-service.ts"));
    expect(src.match(/memberType: "PROFILE"/g)?.length).toBeGreaterThanOrEqual(1);
    const creation = src.slice(src.indexOf("export async function createThread"), src.indexOf("// ---------- staff messages"));
    expect(creation.match(/memberType: "PROFILE", profileId/g)?.length).toBe(1);
    expect(src).not.toMatch(/APPLICANT_TO_APPLICANT|PEER_CHAT|DIRECT_CHAT/);
  });
});

describe("official channels only, no leaked credentials", () => {
  it("has no unofficial WhatsApp automation dependency or import", () => {
    const pkg = readFileSync(join(process.cwd(), "package.json"), "utf8");
    expect(pkg).not.toMatch(/whatsapp-web\.js|baileys|venom-bot|wppconnect|puppeteer|playwright|selenium|yowsup/i);
    for (const f of allFiles) expect(read(f), rel(f)).not.toMatch(/whatsapp-web\.js|@whiskeysockets|venom-bot|wppconnect|web\.whatsapp\.com|api\.whatsapp\.com\/send/i);
  });

  it("WhatsApp goes through the official Graph API host only", () => {
    const src = read(join(SRC, "lib/communications/providers/whatsapp-adapter.ts"));
    const hosts = [...src.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(new Set(["graph.facebook.com"]));
  });

  it("no client component references a provider credential", () => {
    const secrets = /TWILIO_|WHATSAPP_(ACCESS|APP|VERIFY)|SMTP_(USER|PASS)|EMAIL_WEBHOOK_SECRET|COMMUNICATION_ENCRYPTION_KEY|NOTIFICATION_WEBHOOK_SECRET/;
    for (const f of allFiles) {
      const src = read(f);
      const isClient = /^\s*["']use client["']/m.test(src.slice(0, 200)) || rel(f).startsWith("components/");
      if (isClient) expect(src, rel(f)).not.toMatch(secrets);
      expect(src, rel(f)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(TWILIO|WHATSAPP|SMTP|WEBHOOK_SECRET)/);
    }
  });

  it("route responses never include a credential field", () => {
    for (const f of adminCommRoutes) expect(read(f), rel(f)).not.toMatch(/process\.env\.(TWILIO|WHATSAPP_ACCESS|WHATSAPP_APP|SMTP_PASS|EMAIL_WEBHOOK)/);
    const svc = read(join(SRC, "lib/communications/provider-service.ts"));
    expect(svc).toContain("configured: present(n)"); // only yes/no per credential NAME
    expect(svc).not.toMatch(/env\[[^\]]+\]\??\.trim\(\)\s*[,}]/); // a credential value is never placed in a payload
  });

  it("the outbound messages table is never read back with its body in a list endpoint", () => {
    const svc = read(join(SRC, "lib/communications/log-service.ts"));
    const serialize = svc.slice(svc.indexOf("export function serializeLog"), svc.indexOf("export async function searchLogs"));
    expect(serialize).not.toMatch(/messageBody\s*:/);
  });
});

describe("webhook routes", () => {
  it("email, sms and whatsapp each rate-limit and delegate to the signature-verifying pipeline", () => {
    for (const ch of ["email", "sms", "whatsapp"]) {
      const src = read(join(SRC, `app/api/webhooks/${ch}/route.ts`));
      expect(src, ch).toContain("enforcePersistentLimit(");
      expect(src, ch).toContain("handleWebhookRequest(");
    }
    const helper = read(join(SRC, "lib/communications/webhook-route.ts"));
    expect(helper).toContain("handleProviderWebhook(");
    expect(helper).toMatch(/Payload too large/);
    const svc = read(join(SRC, "lib/communications/webhook-service.ts"));
    expect(svc).toContain("verifyWebhook(");
    expect(svc).toMatch(/return \{ httpStatus: 401/);
  });

  it("the legacy webhook fails closed without a secret", () => {
    const src = read(join(SRC, "app/api/webhooks/notifications/route.ts"));
    expect(src).toMatch(/if \(!secret\) return NextResponse\.json\(\{ error: "Webhook is not configured" \}, \{ status: 503 \}\)/);
  });
});
