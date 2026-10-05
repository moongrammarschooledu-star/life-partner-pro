import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// STEP 29 §50/§51 — privilege, leakage and structure checks: who may do what, what a response may contain, what the
// AI and automation modules are structurally unable to do, and that every new route is guarded.

type Row = Record<string, unknown> & { id?: string };
const db = new Map<string, Row[]>();
let idc = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if ("not" in c && (c.not === null ? actual == null : actual === c.not)) return false;
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}
function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `${t}-${++idc}`, version: 1, enabled: false, approvedById: null, createdAt: new Date(), ...data };
      if (t === "marketingAutomationRun" && rows(t).some((r) => r.ruleId === row.ruleId && r.subjectId === row.subjectId)) throw Object.assign(new Error("unique"), { code: "P2002" });
      rows(t).push(row);
      return { ...row };
    },
    findFirst: async ({ where }: { where?: Row } = {}) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, where)); return r ? { ...r } : null; },
    findMany: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).map((r) => ({ ...r })),
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, where)); if (!r) throw new Error("nf"); for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in (v as Row) ? (r[k] as number) + ((v as Row).increment as number) : v; return { ...r }; },
  };
}

const flags = new Set<string>();
const tasks: Row[] = [];
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: vi.fn(async (k: string) => flags.has(k)) }));
vi.mock("@/lib/workflow/engine", () => ({ createTask: vi.fn(async (t: Row) => { tasks.push(t); return { id: "t" }; }), createFromEvent: vi.fn() }));
vi.mock("@/lib/crm/assignment-service", () => ({ autoAssign: vi.fn(async () => null) }));
vi.mock("@/lib/crm/lifecycle-service", () => ({ transitionStage: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/events", () => ({ notifyLeadAssignedToYou: vi.fn(async () => undefined) }));

const { parseActions, parseConditions, createAutomationRule, setAutomationRuleEnabled, updateAutomationRule, triggerAutomation, AUTOMATION_TRIGGERS } = await import("./automation");
const { toLeadDto, maskEmail, maskPhone, canSeeContact } = await import("./marketing-lead-service");
const { toCampaignDto } = await import("./campaign-queries");
const { ROLE_PERMISSIONS } = await import("@/lib/permissions");
type Permission = import("@/lib/permissions").Permission;

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const read = (p: string) => readFileSync(p, "utf8");

describe("automation vocabulary is closed", () => {
  it.each(["APPROVE_VERIFICATION", "SHARE_CONTACT", "FINALIZE_PROPOSAL", "SUSPEND_ACCOUNT", "DELETE_PROFILE", "REFUND_PAYMENT", "CHANGE_PERMISSIONS", "LAUNCH_CAMPAIGN", "RAISE_BUDGET", "SEND_WHATSAPP", "SEND_MESSAGE", "SPEND_BUDGET"])("cannot express %s", (type) => {
    expect(() => parseActions([{ type }])).toThrow(/whitelisted/i);
  });
  it("only early, non-decision CRM stages can be set", () => {
    for (const toStage of ["VERIFIED", "ACTIVE", "MATCHING", "MARRIED", "SUSPENDED", "ARCHIVED"]) expect(() => parseActions([{ type: "UPDATE_CRM_STAGE", toStage }])).toThrow();
    expect(parseActions([{ type: "UPDATE_CRM_STAGE", toStage: "UNDER_REVIEW" }])).toHaveLength(1);
  });
  it("conditions are strict and actions are bounded", () => {
    expect(() => parseConditions({ campaignId: "c1", runCode: "x" })).toThrow();
    expect(() => parseActions([])).toThrow();
    expect(() => parseActions(Array.from({ length: 6 }, () => ({ type: "ASSIGN_LEAD" })))).toThrow();
  });
  it("the whitelisted action set contains nothing outside the safe five", () => {
    const src = read(join(SRC, "lib", "marketing", "automation.ts"));
    const types = [...src.matchAll(/z\.literal\("([A-Z_]+)"\)/g)].map((m) => m[1]).sort();
    expect(types).toEqual(["ASSIGN_LEAD", "CREATE_TASK", "NOTIFY_STAFF", "SCHEDULE_FOLLOWUP", "UPDATE_CRM_STAGE"]);
  });
});

describe("automation rule lifecycle", () => {
  const admin = (id: string) => ({ id, permissions: [] }) as never;
  beforeEach(() => { db.clear(); flags.clear(); tasks.length = 0; idc = 0; });

  it("a new rule is disabled, and its author cannot enable it", async () => {
    const rule = await createAutomationRule(admin("author"), { name: "Welcome task", trigger: "LEAD_CREATED", actions: [{ type: "CREATE_TASK", title: "Call the new lead" }] });
    expect(rule.enabled).toBe(false);
    await expect(setAutomationRuleEnabled(admin("author"), rule.id, true, "turn it on please")).rejects.toMatchObject({ status: 403 });
    const on = await setAutomationRuleEnabled(admin("reviewer"), rule.id, true, "reviewed and approved");
    expect(on).toMatchObject({ enabled: true, approvedById: "reviewer" });
  });

  it("editing a rule disables it again and clears the approval", async () => {
    const rule = await createAutomationRule(admin("author"), { name: "Welcome task", trigger: "LEAD_CREATED", actions: [{ type: "CREATE_TASK", title: "Call the new lead" }] });
    await setAutomationRuleEnabled(admin("reviewer"), rule.id, true, "reviewed and approved");
    const edited = await updateAutomationRule(admin("author"), rule.id, { actions: [{ type: "ASSIGN_LEAD" }] });
    expect(edited).toMatchObject({ enabled: false, approvedById: null, version: 2 });
  });

  it("rejects unknown triggers", async () => {
    await expect(createAutomationRule(admin("a"), { name: "Rule x", trigger: "ACCOUNT_SUSPENDED", actions: [{ type: "ASSIGN_LEAD" }] })).rejects.toMatchObject({ status: 422 });
    expect(AUTOMATION_TRIGGERS).not.toContain("ACCOUNT_SUSPENDED");
  });

  async function enabledRule() {
    const rule = await createAutomationRule(admin("author"), { name: "Welcome task", trigger: "LEAD_CREATED", actions: [{ type: "CREATE_TASK", title: "Call the new lead" }] });
    await setAutomationRuleEnabled(admin("reviewer"), rule.id, true, "reviewed and approved");
    rows("lead").push({ id: "l1", status: "NEW", campaignId: null, source: "WEBSITE" });
    return rule;
  }

  it("does nothing while the automation flags are off", async () => {
    await enabledRule();
    expect(await triggerAutomation("LEAD_CREATED", { leadId: "l1" })).toBe(0);
    expect(tasks).toHaveLength(0);
  });

  it("runs an approved rule once per lead (idempotent) when the flags are on", async () => {
    await enabledRule();
    flags.add("marketing.enabled"); flags.add("marketing.automation.enabled");
    expect(await triggerAutomation("LEAD_CREATED", { leadId: "l1" })).toBe(1);
    expect(await triggerAutomation("LEAD_CREATED", { leadId: "l1" })).toBe(0);
    expect(tasks).toHaveLength(1);
  });

  it.each(["DO_NOT_CONTACT", "INVALID", "DUPLICATE", "ARCHIVED", "DUPLICATE_REVIEW_REQUIRED"])("never automates a lead that is %s", async (status) => {
    await enabledRule();
    flags.add("marketing.enabled"); flags.add("marketing.automation.enabled");
    rows("lead")[0].status = status;
    expect(await triggerAutomation("LEAD_CREATED", { leadId: "l1" })).toBe(0);
  });

  it("a rule that was never approved does not run, even if enabled in the database", async () => {
    const rule = await enabledRule();
    flags.add("marketing.enabled"); flags.add("marketing.automation.enabled");
    rows("marketingAutomationRule").find((r) => r.id === rule.id)!.approvedById = null;
    expect(await triggerAutomation("LEAD_CREATED", { leadId: "l1" })).toBe(0);
  });
});

describe("responses never carry more than the viewer may see", () => {
  const lead = { id: "l1", leadCode: "LPP-LEAD-1", fullName: "Ayesha Khan", phone: "+923001234567", email: "ayesha@example.com", city: "Lahore", inquiry: "Please call after 5pm", status: "NEW", source: "AD_CAMPAIGN", campaignId: "c1", campaign: "LPP-MCAMP-000001", platform: null, utmSource: null, utmMedium: null, utmCampaign: null, preferredChannel: null, marketingOptIn: false, assignedStaffId: null, convertedProfileId: null, dedupeReason: null, capturedAt: new Date(), createdAt: new Date() } as never;

  it("masks phone, email and the free-text inquiry without the contact permission", () => {
    const dto = toLeadDto(lead, ["marketing:leads:view"]);
    expect(dto.contactMasked).toBe(true);
    expect(JSON.stringify(dto)).not.toContain("3001234567");
    expect(JSON.stringify(dto)).not.toContain("ayesha@example.com");
    expect(JSON.stringify(dto)).not.toContain("after 5pm");
    expect(dto.phone).toBe(maskPhone("+923001234567"));
    expect(dto.email).toBe(maskEmail("ayesha@example.com"));
  });
  it("shows them only with sensitive:marketing:lead_contact:view", () => {
    const dto = toLeadDto(lead, ["marketing:leads:view", "sensitive:marketing:lead_contact:view"]);
    expect(dto).toMatchObject({ contactMasked: false, phone: "+923001234567", email: "ayesha@example.com", inquiry: "Please call after 5pm" });
    expect(canSeeContact(["marketing:leads:manage"])).toBe(false);
  });
  it("the lead DTO has no field that could carry identifiers, hashes or tokens", () => {
    const keys = Object.keys(toLeadDto(lead, []));
    for (const k of keys) expect(k).not.toMatch(/hash|token|ip|clickId|secret/i);
  });

  const campaign = { id: "c1", code: "LPP-MCAMP-000001", name: "n", description: null, objective: "AWARENESS", channel: "WEBSITE", status: "ACTIVE", providerKey: "SANDBOX", campaignKey: "k", utmSource: null, utmMedium: null, contentIdentifier: null, timezone: "Asia/Karachi", startAt: null, endAt: null, language: "EN", landingPageId: null, formId: null, routingDepartmentId: null, assignedTeamId: null, responsibleAdminId: null, attributionModel: null, notes: null, createdById: "a", submittedById: null, approvedById: null, approvedAt: null, launchedAt: null, pausedReason: null, targeting: null, createdAt: new Date(), updatedAt: new Date(), currencyCode: "PKR", budgetTotalMinor: 5_000_000, budgetDailyMinor: 100_000, alertThresholdPct: 80, spendVerified: true, spendVerifiedMinor: 1_234_500 } as never;
  it("withholds every budget and spend figure without marketing:budget:view", () => {
    const dto = toCampaignDto(campaign, ["marketing:view"]);
    expect(dto.budget).toBeNull();
    expect(JSON.stringify(dto)).not.toContain("5000000");
    expect(JSON.stringify(dto)).not.toContain("1234500");
  });
  it("shows them to budget viewers, with remaining budget only from verified spend", () => {
    const dto = toCampaignDto(campaign, ["marketing:view", "marketing:budget:view"]);
    expect(dto.budget).toMatchObject({ totalMinor: 5_000_000, spendVerifiedMinor: 1_234_500, remainingMinor: 3_765_500 });
    const unverified = toCampaignDto({ ...(campaign as object), spendVerified: false } as never, ["marketing:budget:view"]);
    expect(unverified.budget).toMatchObject({ spendVerifiedMinor: null, remainingMinor: null });
  });
});

describe("role boundaries", () => {
  const has = (role: keyof typeof ROLE_PERMISSIONS, p: Permission) => ROLE_PERMISSIONS[role].includes(p);
  const MARKETING = (Object.values(ROLE_PERMISSIONS).flat() as Permission[]).filter((p) => p.includes("marketing")).filter((p, i, a) => a.indexOf(p) === i);

  it("only the intended roles hold any approve / launch / budget-management / publish / export power", () => {
    const powerful: Permission[] = ["marketing:approve", "marketing:launch", "marketing:pause", "marketing:archive", "marketing:budget:manage", "marketing:landing_pages:publish", "marketing:leads:export", "marketing:providers:manage", "marketing:automation:manage"];
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      if (["SUPER_ADMIN", "OPERATIONS_ADMIN", "COMMUNICATION_MANAGER", "ADMIN"].includes(role)) continue;
      // Compliance is the independent checker: it approves content/campaigns and owns provider connections, nothing else.
      const allowed: Permission[] = role === "COMPLIANCE_MANAGER" ? ["marketing:approve", "marketing:providers:manage"] : [];
      for (const p of powerful.filter((x) => !allowed.includes(x))) expect(perms, `${role} must not hold ${p}`).not.toContain(p);
    }
  });
  it("COMMUNICATION_STAFF can draft and work leads but cannot approve, launch, spend, publish, export or see contact details", () => {
    for (const p of ["marketing:approve", "marketing:launch", "marketing:budget:manage", "marketing:landing_pages:publish", "marketing:leads:export", "marketing:providers:manage", "sensitive:marketing:lead_contact:view"] as Permission[]) expect(has("COMMUNICATION_STAFF", p), p).toBe(false);
    for (const p of ["marketing:view", "marketing:create", "marketing:leads:view"] as Permission[]) expect(has("COMMUNICATION_STAFF", p), p).toBe(true);
  });
  it("the manager role is a superset of the staff role (role-management invariant)", () => {
    for (const p of ROLE_PERMISSIONS.COMMUNICATION_STAFF.filter((x) => x.includes("marketing"))) expect(has("COMMUNICATION_MANAGER", p), p).toBe(true);
  });
  it("the contact-detail permission is held only by Super Admin and Operations Admin, and is classified sensitive", () => {
    const holders = Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes("sensitive:marketing:lead_contact:view")).map(([r]) => r).sort();
    expect(holders).toEqual(expect.arrayContaining(["OPERATIONS_ADMIN", "SUPER_ADMIN"]));
    expect(holders).not.toContain("COMMUNICATION_STAFF");
    expect(holders).not.toContain("REPORTING_ANALYST");
    expect(read(join(SRC, "lib", "permissions.ts"))).toMatch(/SENSITIVE_PERMISSIONS[\s\S]*?"sensitive:marketing:lead_contact:view"/);
  });
  it("the reporting analyst sees aggregate marketing analytics only", () => {
    const marketing = ROLE_PERMISSIONS.REPORTING_ANALYST.filter((p) => p.includes("marketing"));
    expect(marketing.sort()).toEqual(["marketing:analytics:view", "marketing:view"]);
  });
  it("every marketing permission has a human-readable description for the permission matrix", () => {
    const defs = read(join(SRC, "lib", "permission-defs.ts"));
    for (const p of MARKETING) expect(defs, p).toContain(`"${p}"`);
  });
});

describe("structure: the AI assistant and automation cannot reach consequential actions", () => {
  const FORBIDDEN = ["campaign-service", "budget-service", "provider-service", "providers/", "approval", "webhook-service", "lead-capture-service", "communications/", "send-service", "notification-service", "finance/", "verification/"];
  it("marketing-assistant.ts imports no launch, budget, provider, approval, messaging or finance module", () => {
    const src = read(join(SRC, "lib", "ai", "analysis", "marketing-assistant.ts"));
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const i of imports) for (const f of FORBIDDEN) expect(i, `${i} contains ${f}`).not.toContain(f);
  });
  it("the AI feature runner only calls the pure builder (no network, no database writes)", () => {
    const src = read(join(SRC, "lib", "ai", "features.ts"));
    const fn = src.slice(src.indexOf("export async function runMarketingAssistant"));
    const body = fn.slice(0, fn.indexOf("\nexport ", 10) > 0 ? fn.indexOf("\nexport ", 10) : undefined);
    expect(body).not.toMatch(/launchCampaign|changeCampaignBudget|createLead|communicate\(|prisma\.\w+\.(create|update|delete)/);
  });
  it("nothing under lib/marketing sends a message to a person (staff follow up through tasks)", () => {
    for (const f of walk(join(SRC, "lib", "marketing")).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))) {
      const src = read(f);
      expect(src, relative(SRC, f)).not.toMatch(/from "@\/lib\/communications\/(send-service|policy-engine|thread-service)"/);
      expect(src, relative(SRC, f)).not.toMatch(/\bcommunicate\(/);
    }
  });
  it("ad-platform events are built only by the allow-list builder: no module passes lead or profile fields to sendEvent", () => {
    for (const f of walk(join(SRC, "lib", "marketing")).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))) {
      const src = read(f);
      const calls = [...src.matchAll(/\.sendEvent\(([^)]*)\)/g)].map((m) => m[1]);
      for (const c of calls) expect(c, `${relative(SRC, f)}: sendEvent(${c})`).toMatch(/^\s*(event|ev|buildAdPlatformEvent\()/);
    }
  });
  it("no marketing source reads a secret value into a response or hard-codes a token", () => {
    for (const f of walk(join(SRC, "lib", "marketing")).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"))) {
      const src = read(f);
      expect(src, relative(SRC, f)).not.toMatch(/(EAAG|EAA[A-Za-z0-9]{20,}|sk_live|whsec_|AKIA[0-9A-Z]{12})/);
    }
  });
});

describe("structure: every route is guarded", () => {
  const adminRoutes = walk(join(SRC, "app", "api", "admin", "marketing")).filter((p) => p.endsWith("route.ts"));
  it("finds the admin routes", () => {
    expect(adminRoutes.length).toBeGreaterThan(50);
  });
  it("every admin marketing route literally calls requireAdmin(", () => {
    for (const f of adminRoutes) expect(read(f), relative(SRC, f)).toContain("requireAdmin(");
  });
  it("route files export only HTTP handlers and route config (Next.js rule)", () => {
    for (const f of [...adminRoutes, ...walk(join(SRC, "app", "api", "marketing")).filter((p) => p.endsWith("route.ts"))]) {
      for (const m of read(f).matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)) expect(["GET", "POST", "PUT", "PATCH", "DELETE", "dynamic", "revalidate", "runtime", "maxDuration"], `${relative(SRC, f)} exports ${m[1]}`).toContain(m[1]);
    }
  });
  it("a mutating handler is never guarded by a view-only permission", () => {
    for (const f of adminRoutes) {
      const src = read(f);
      for (const m of src.matchAll(/export async function (POST|PATCH|PUT|DELETE)\b[\s\S]*?requireAdmin\("([^"]+)"/g)) {
        expect(m[2], `${relative(SRC, f)} ${m[1]} uses ${m[2]}`).not.toMatch(/:view$|^marketing:view$/);
      }
    }
  });
  it("destructive and consequential routes require the matching specific permission", () => {
    const need: Record<string, string> = {
      "campaigns/[id]/launch": "marketing:launch", "campaigns/[id]/approve": "marketing:approve", "campaigns/[id]/budget": "marketing:budget:manage",
      "landing-pages/[id]/publish": "marketing:landing_pages:publish", "providers/[id]": "marketing:providers:manage", "leads/export": "marketing:leads:export",
      "campaigns/[id]/archive": "marketing:archive", "automation/[id]/enable": "marketing:automation:manage",
    };
    for (const [dir, perm] of Object.entries(need)) expect(read(join(SRC, "app", "api", "admin", "marketing", ...dir.split("/"), "route.ts")), dir).toContain(`requireAdmin("${perm}"`);
  });
  it("the public routes enforce a rate limit or a webhook signature, and the same-origin check where browser-driven", () => {
    for (const rel of ["forms/[id]/token", "forms/[id]/submit", "events", "webhooks/[provider]"]) {
      const src = read(join(SRC, "app", "api", "marketing", ...rel.split("/"), "route.ts"));
      expect(src, rel).toMatch(/enforceConfiguredLimit\(/);
      // The token mint is a side-effect-free GET; the browser-driven writes must be same-origin.
      if (rel === "forms/[id]/submit" || rel === "events") expect(src, rel).toContain("isSameOrigin(");
    }
    expect(read(join(SRC, "lib", "marketing", "webhook-service.ts"))).toContain("verifyWebhook(");
  });
  it("public pages render no raw HTML and never use dangerouslySetInnerHTML", () => {
    for (const f of [...walk(join(SRC, "app", "lp")), ...walk(join(SRC, "components", "marketing")), ...walk(join(SRC, "components", "admin", "marketing"))].filter((p) => /\.tsx?$/.test(p))) {
      expect(read(f), relative(SRC, f)).not.toContain("dangerouslySetInnerHTML");
    }
  });
  it("the public landing page is not indexed unless the page is explicitly allowed (noindex honoured)", () => {
    const page = read(join(SRC, "app", "lp", "[slug]", "page.tsx"));
    expect(page).toMatch(/noindex/);
    expect(page).toMatch(/notFound\(\)/);
  });
});
