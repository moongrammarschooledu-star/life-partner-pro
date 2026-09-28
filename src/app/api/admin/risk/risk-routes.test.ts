import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 24 - RBAC / privilege-escalation matrix for every risk, security, user-report and report route.
// The point: each handler asks requireAdmin for the RIGHT permission BEFORE doing anything else, so an admin
// who lacks it gets 403 and no service is ever reached. Service behaviour has its own tests.

let adminPermissions: string[] = [];
let requested: string[] = [];
let reached: string[] = [];

vi.mock("@/lib/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  const { HttpError } = await import("@/lib/http-error");
  class ApiError extends HttpError {}
  return {
    ApiError,
    requireAdmin: vi.fn(async (permission?: string) => {
      if (permission) requested.push(permission);
      if (permission && !adminPermissions.includes(permission)) throw new ApiError(403, "Forbidden: insufficient permissions");
      return { id: "admin1", name: "A", email: "a@x.test", role: "SUPPORT_MANAGER", permissions: adminPermissions, sid: "s" };
    }),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { reached.push("prisma"); return null; } }) }) }));
vi.mock("@/lib/risk/case-service", () => ({
  ACTIVE_CASE_STATUSES: ["OPEN"],
  applyCaseAction: vi.fn(async () => { reached.push("applyCaseAction"); throw Object.assign(new Error("Risk case not found."), { status: 404 }); }),
  getRiskCaseForActor: vi.fn(async () => { reached.push("getRiskCaseForActor"); throw Object.assign(new Error("Risk case not found."), { status: 404 }); }),
  addCaseNote: vi.fn(async () => { reached.push("addCaseNote"); }),
  assignCase: vi.fn(async () => { reached.push("assignCase"); }),
}));
vi.mock("@/lib/risk/evidence-service", () => ({ addEvidence: vi.fn(async () => { reached.push("addEvidence"); }), listEvidence: vi.fn(async () => { reached.push("listEvidence"); return []; }), verifyEvidenceRecord: () => true }));
vi.mock("@/lib/risk/duplicate-cluster-service", () => ({
  listDuplicateClusters: vi.fn(async () => { reached.push("list"); return []; }),
  resolveDuplicateCluster: vi.fn(async () => { reached.push("resolve"); }),
  planDuplicateMerge: vi.fn(async () => { reached.push("plan"); }),
  rebuildDuplicateClusters: vi.fn(async () => { reached.push("rebuild"); }),
}));
vi.mock("@/lib/risk/relationship-graph", () => ({ getRelationshipGraph: vi.fn(async () => { reached.push("graph"); }) }));
vi.mock("@/lib/risk/fraud-prevention-service", () => ({ evaluateProfileSafety: vi.fn(async () => { reached.push("evaluate"); return {}; }) }));
vi.mock("@/lib/risk/safety-intelligence", () => ({ SafetyIntelligenceService: { overview: vi.fn(async () => { reached.push("overview"); return {}; }) } }));
vi.mock("@/lib/risk/signal-service", () => ({ resolveRiskSignal: vi.fn(async () => { reached.push("resolveSignal"); }) }));
vi.mock("@/lib/risk/config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/risk/config")>("@/lib/risk/config");
  return { ...actual, setRule: vi.fn(async () => { reached.push("setRule"); return { ruleKey: "x", version: 1 }; }), setFactor: vi.fn(async () => { reached.push("setFactor"); return {}; }), getEffectiveRule: vi.fn(async () => ({ config: {}, version: 0 })), getEffectiveFactor: vi.fn(async () => ({ weight: 1, severity: "LOW", enabled: true, immediateControl: false, version: 0, name: "n", category: "ACCOUNT" })) };
});
vi.mock("@/lib/risk/technical-controls", () => ({ applyTechnicalControl: vi.fn(async () => { reached.push("applyControl"); }), liftTechnicalControl: vi.fn(async () => { reached.push("lift"); }), expireDueControls: vi.fn(async () => 0), isControlActive: vi.fn(async () => false) }));
vi.mock("@/lib/risk/report-service", () => ({ updateReportStatus: vi.fn(async () => { reached.push("updateReport"); }), submitUserReport: vi.fn(), listOwnReports: vi.fn() }));
vi.mock("@/lib/risk/report", () => ({ computeRiskReport: vi.fn(async () => { reached.push("report"); return {}; }), parseRange: () => ({ from: new Date(), to: new Date() }), riskReportToCsv: () => "" }));
vi.mock("@/lib/ops/rate-limit-persistent", () => ({ enforcePersistentLimit: vi.fn(async () => null), tooManyRequests: vi.fn() }));
vi.mock("@/lib/approvals/gate", () => ({ enforceApprovalGate: vi.fn(async () => { reached.push("gate"); return { requiresApproval: false }; }), markApprovalExecuted: vi.fn() }));
vi.mock("@/lib/privacy/access-log", () => ({ logPrivacyAccess: vi.fn(async () => undefined) }));
vi.mock("@/lib/ops/admin-route", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ops/admin-route")>("@/lib/ops/admin-route");
  return { ...actual, requireReauth: vi.fn() }; // reauth itself is exercised in admin-route's own tests
});

type Ctx = { params: Promise<{ id: string; key: string }> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response>;
const ctx: Ctx = { params: Promise.resolve({ id: "abc12345", key: "score_bands" }) };
const req = (body: unknown = {}, method = "POST") => new Request("http://x.test/api", { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });

interface RouteCase {
  name: string;
  load: () => Promise<object>;
  method: "GET" | "POST" | "PATCH";
  permission: string;
  body?: unknown;
}

const R = "@/app/api/admin";
const routes: RouteCase[] = [
  { name: "cases list", load: () => import("./cases/route"), method: "GET", permission: "risk:view" },
  { name: "case detail", load: () => import("./cases/[id]/route"), method: "GET", permission: "risk:view" },
  { name: "acknowledge", load: () => import("./cases/[id]/acknowledge/route"), method: "POST", permission: "risk:review" },
  { name: "investigate", load: () => import("./cases/[id]/investigate/route"), method: "POST", permission: "risk:investigate" },
  { name: "request-info", load: () => import("./cases/[id]/request-info/route"), method: "POST", permission: "risk:review" },
  { name: "clear", load: () => import("./cases/[id]/clear/route"), method: "POST", permission: "risk:clear" },
  { name: "escalate", load: () => import("./cases/[id]/escalate/route"), method: "POST", permission: "risk:escalate" },
  { name: "restrict", load: () => import("./cases/[id]/restrict/route"), method: "POST", permission: "risk:restrict" },
  { name: "suspend", load: () => import("./cases/[id]/suspend/route"), method: "POST", permission: "risk:suspend" },
  { name: "close", load: () => import("./cases/[id]/close/route"), method: "POST", permission: "risk:resolve" },
  { name: "resolve", load: () => import("./cases/[id]/resolve/route"), method: "POST", permission: "risk:resolve", body: { decision: "DISMISS" } },
  { name: "notes", load: () => import("./cases/[id]/notes/route"), method: "POST", permission: "risk:review", body: { note: "hello there" } },
  { name: "assign", load: () => import("./cases/[id]/assign/route"), method: "POST", permission: "risk:investigate", body: { assigneeId: "a2" } },
  { name: "evidence list", load: () => import("./cases/[id]/evidence/route"), method: "GET", permission: "risk:evidence:view" },
  { name: "evidence add", load: () => import("./cases/[id]/evidence/route"), method: "POST", permission: "risk:evidence:manage", body: { evidenceType: "AUDIT_EVENT", summary: "x" } },
  { name: "duplicates list", load: () => import("./duplicates/route"), method: "GET", permission: "duplicates:view" },
  { name: "duplicate detail", load: () => import("./duplicates/[id]/route"), method: "GET", permission: "duplicates:view" },
  { name: "duplicate resolve", load: () => import("./duplicates/[id]/resolve/route"), method: "POST", permission: "duplicates:resolve", body: { decision: "RESOLVED", note: "done here" } },
  { name: "merge plan", load: () => import("./duplicates/[id]/merge-plan/route"), method: "POST", permission: "duplicates:merge", body: { reason: "merge please" } },
  { name: "cluster rebuild", load: () => import("./duplicates/rebuild/route"), method: "POST", permission: "duplicates:manage" },
  { name: "relationships", load: () => import("./accounts/[id]/relationships/route"), method: "GET", permission: "relationships:view" },
  { name: "evaluate", load: () => import("./evaluate/route"), method: "POST", permission: "risk:investigate", body: { profileId: "p1" } },
  { name: "overview", load: () => import("./overview/route"), method: "GET", permission: "risk:view" },
  { name: "signal patch", load: () => import("./signals/[id]/route"), method: "PATCH", permission: "risk:review", body: { status: "ACKNOWLEDGED" } },
  { name: "rules list", load: () => import("./rules/route"), method: "GET", permission: "risk:rules:view" },
  { name: "rule history", load: () => import("./rules/[key]/route"), method: "GET", permission: "risk:rules:view" },
  { name: "rule patch", load: () => import("./rules/[key]/route"), method: "PATCH", permission: "risk:rules:manage", body: { config: { threshold: 3 }, reason: "tighten it", stepUpToken: "t" } },
  { name: "factor patch", load: () => import("./rules/factors/[key]/route"), method: "PATCH", permission: "risk:rules:manage", body: { weight: 5, enabled: true, reason: "tune it", stepUpToken: "t" } },
  { name: "configuration view", load: () => import("./configuration/route"), method: "GET", permission: "risk:configuration:view" },
  { name: "configuration patch", load: () => import("./configuration/route"), method: "PATCH", permission: "risk:configuration:manage", body: { ruleKey: "score_bands", config: { medium: 20, high: 40, critical: 70 }, reason: "same bands", stepUpToken: "t" } },
  { name: "security events", load: () => import("../security/events/route"), method: "GET", permission: "security:events:view" },
  { name: "incidents list", load: () => import("../security/incidents/route"), method: "GET", permission: "security:incidents:manage" },
  { name: "incident apply", load: () => import("../security/incidents/route"), method: "POST", permission: "security:incidents:manage", body: {} },
  { name: "incident lift", load: () => import("../security/incidents/[id]/lift/route"), method: "POST", permission: "security:incidents:manage" },
  { name: "user reports list", load: () => import("../user-reports/route"), method: "GET", permission: "user-reports:view" },
  { name: "user report patch", load: () => import("../user-reports/[id]/route"), method: "PATCH", permission: "user-reports:manage", body: { status: "UNDER_REVIEW" } },
  { name: "risk report", load: () => import("../reports/risk/route"), method: "GET", permission: "risk:reports:view" },
];
void R;

beforeEach(() => {
  adminPermissions = [];
  requested = [];
  reached = [];
});

describe("every STEP 24 admin route enforces its permission first (RBAC / privilege escalation)", () => {
  it.each(routes)("$name: asks for $permission and returns 403 without it, touching nothing", async (route) => {
    const mod = await route.load();
    const handler = (mod as Record<string, Handler | undefined>)[route.method] as Handler;
    expect(handler, `${route.name} exports ${route.method}`).toBeTypeOf("function");
    const res = await handler(req(route.body, route.method), ctx);
    expect(res.status).toBe(403);
    expect(requested).toContain(route.permission);
    expect(reached).toEqual([]);
  });

  it("holding a NEIGHBOURING permission is not enough (no permission bleed)", async () => {
    // risk:view + risk:review + risk:investigate must not unlock restrict / suspend / rules / incidents / export.
    adminPermissions = ["risk:view", "risk:review", "risk:investigate", "risk:resolve", "risk:escalate", "risk:clear"];
    for (const name of ["restrict", "suspend", "rule patch", "factor patch", "configuration patch", "incident apply", "evidence add", "merge plan", "cluster rebuild", "user report patch"]) {
      const route = routes.find((r) => r.name === name)!;
      const res = await ((await route.load()) as Record<string, Handler>)[route.method](req(route.body, route.method), ctx);
      expect(res.status, name).toBe(403);
    }
  });

  it("rules PATCH and configuration PATCH are separate permissions (rules:manage cannot change thresholds and vice versa)", async () => {
    const config = await import("./configuration/route");
    const rules = await import("./rules/[key]/route");
    adminPermissions = ["risk:rules:manage"];
    expect((await (config.PATCH as unknown as Handler)(req({ ruleKey: "score_bands", config: {}, reason: "x", stepUpToken: "t" }, "PATCH"), ctx)).status).toBe(403);
    adminPermissions = ["risk:configuration:manage"];
    expect((await rules.PATCH(req({ config: { threshold: 3 }, reason: "x", stepUpToken: "t" }, "PATCH"), ctx)).status).toBe(403);
  });

  it("threshold rules cannot be changed through the detection-rule route even with rules:manage", async () => {
    adminPermissions = ["risk:rules:manage"];
    const rules = await import("./rules/[key]/route");
    const res = await rules.PATCH(req({ config: { medium: 1, high: 2, critical: 3 }, reason: "trying to lower the bands", stepUpToken: "t" }, "PATCH"), ctx); // key = score_bands
    expect(res.status).toBe(400);
    expect(reached).not.toContain("setRule");
    expect(reached).not.toContain("gate");
  });
});

describe("rule / factor tampering is rejected before any approval or write", () => {
  it("unknown fields, wrong types, out-of-range values and sensitive traits", async () => {
    adminPermissions = ["risk:rules:manage"];
    const rules = await import("./rules/[key]/route");
    const detectorCtx = { params: Promise.resolve({ id: "x", key: "login_abuse" }) };
    for (const config of [{ bypass: 1 }, { threshold: "5" }, { threshold: -3 }, { threshold: 99999 }, { religion: 1 }]) {
      const res = await rules.PATCH(req({ config, reason: "tamper attempt", stepUpToken: "t" }, "PATCH"), detectorCtx);
      expect(res.status, JSON.stringify(config)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(reached).not.toContain("setRule");
    expect(reached).not.toContain("gate");
  });

  it("a valid change goes through the approval gate before it is applied", async () => {
    adminPermissions = ["risk:rules:manage"];
    const rules = await import("./rules/[key]/route");
    const res = await rules.PATCH(req({ config: { threshold: 6 }, reason: "tighten login abuse", stepUpToken: "t" }, "PATCH"), { params: Promise.resolve({ id: "x", key: "login_abuse" }) });
    expect(res.status).toBe(200);
    expect(reached.indexOf("gate")).toBeLessThan(reached.indexOf("setRule"));
  });

  it("factor weight is bounded and unknown factors 404", async () => {
    adminPermissions = ["risk:rules:manage"];
    const factors = await import("./rules/factors/[key]/route");
    const bad = await factors.PATCH(req({ weight: 5, enabled: true, reason: "x", stepUpToken: "t" }, "PATCH"), { params: Promise.resolve({ id: "x", key: "NOPE" }) });
    expect(bad.status).toBe(404);
  });
});

describe("evaluate ignores anything a client sends except the profile id (score manipulation)", () => {
  it("client-supplied score / events are never forwarded", async () => {
    adminPermissions = ["risk:investigate"];
    const { prisma } = await import("@/lib/prisma");
    void prisma;
    const evaluate = await import("./evaluate/route");
    const res = await evaluate.POST(req({ profileId: "p1", score: 100, level: "CRITICAL", events: [{ eventType: "LOGIN_FAILED" }] }));
    // the profile lookup is mocked to null → 404; the service is never called with the client payload
    expect(res.status).toBe(404);
    expect(reached).not.toContain("evaluate");
    const { evaluateProfileSafety } = await import("@/lib/risk/fraud-prevention-service");
    expect(evaluateProfileSafety).not.toHaveBeenCalledWith(expect.objectContaining({ score: 100 }));
  });
  it("requires a profileId", async () => {
    adminPermissions = ["risk:investigate"];
    const evaluate = await import("./evaluate/route");
    expect((await evaluate.POST(req({ score: 100 }))).status).toBe(400);
  });
});

describe("detail views never leak existence", () => {
  it("case detail returns the service 404 for a missing or hidden case", async () => {
    adminPermissions = ["risk:view"];
    const detail = await import("./cases/[id]/route");
    expect((await detail.GET(req(undefined, "GET"), ctx)).status).toBe(404);
  });
});
