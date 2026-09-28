import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let policies: Row[];
let controls: Array<{ controlType: string; subjectType: string }>;
let persistentCalls: unknown[][];
let audits: Row[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/ops/rate-limit-persistent", () => ({
  enforcePersistentLimit: vi.fn(async (...args: unknown[]) => { persistentCalls.push(args); return null; }),
  tooManyRequests: vi.fn(() => ({ status: 429, blocked: true })),
}));
vi.mock("@/lib/risk/technical-controls", () => ({ isControlActive: vi.fn(async (controlType: string, subjectType: string) => controls.some((c) => c.controlType === controlType && c.subjectType === subjectType)) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    rateLimitPolicy: {
      findFirst: vi.fn(async () => policies.filter((p) => p.status === "ACTIVE").sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
      create: vi.fn(async ({ data }: { data: Row }) => { policies.push(data); return data; }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  },
}));

const svc = await import("./rate-limit-policy");
const req = new Request("https://x.test/api/register", { headers: { "x-forwarded-for": "9.9.9.9" } });
const DEFAULTS = { limit: 5, windowMs: 60_000 };

beforeEach(() => {
  policies = []; controls = []; persistentCalls = []; audits = [];
  svc.clearRateLimitPolicyCache();
  for (const k of Object.keys(svc.KNOWN_LIMITS)) delete svc.KNOWN_LIMITS[k];
});

describe("enforceConfiguredLimit", () => {
  it("with no policy row, the call site's shipped default is used unchanged", async () => {
    await svc.enforceConfiguredLimit(req, "register", DEFAULTS, "a@b.c");
    expect(persistentCalls[0].slice(1)).toEqual(["register", 5, 60_000, "a@b.c"]);
  });
  it("an active policy overrides the default", async () => {
    policies = [{ policyKey: "register", version: 1, limit: 3, windowSeconds: 120, status: "ACTIVE", enabled: true }];
    await svc.enforceConfiguredLimit(req, "register", DEFAULTS);
    expect(persistentCalls[0].slice(1, 4)).toEqual(["register", 3, 120_000]);
  });
  it("a tampered policy is clamped: never below 1, never above 10x default", async () => {
    policies = [{ policyKey: "register", version: 1, limit: 100_000, windowSeconds: 1, status: "ACTIVE", enabled: true }];
    await svc.enforceConfiguredLimit(req, "register", DEFAULTS);
    expect(persistentCalls[0].slice(2, 4)).toEqual([50, 10_000]);
  });
  it("an active IP-hash block short-circuits to 429 before the counter is touched", async () => {
    controls = [{ controlType: "IP_BLOCK", subjectType: "IP_HASH" }];
    const r = await svc.enforceConfiguredLimit(req, "register", DEFAULTS);
    expect(r).toMatchObject({ status: 429 });
    expect(persistentCalls).toHaveLength(0);
  });
  it("an active subject throttle blocks that subject only", async () => {
    controls = [{ controlType: "SUBJECT_THROTTLE", subjectType: "SUBJECT_KEY" }];
    expect(await svc.enforceConfiguredLimit(req, "register", DEFAULTS, "victim@x.com")).toMatchObject({ status: 429 });
    persistentCalls = [];
    expect(await svc.enforceConfiguredLimit(req, "register", DEFAULTS)).toBeNull(); // no subject → no subject throttle
  });
});

describe("setRateLimitPolicy", () => {
  beforeEach(() => { svc.KNOWN_LIMITS.register = DEFAULTS; });
  it("only registered limiter names can be configured", async () => {
    await expect(svc.setRateLimitPolicy({ policyKey: "made_up", limit: 3, windowSeconds: 60, actorId: "a", reason: "r" })).rejects.toMatchObject({ status: 404 });
  });
  it("enforces bounds so limiting can never be switched off or made absurd", async () => {
    await expect(svc.setRateLimitPolicy({ policyKey: "register", limit: 0, windowSeconds: 60, actorId: "a", reason: "r" })).rejects.toMatchObject({ status: 422 });
    await expect(svc.setRateLimitPolicy({ policyKey: "register", limit: 51, windowSeconds: 60, actorId: "a", reason: "r" })).rejects.toMatchObject({ status: 422 });
    await expect(svc.setRateLimitPolicy({ policyKey: "register", limit: 3, windowSeconds: 5, actorId: "a", reason: "r" })).rejects.toMatchObject({ status: 422 });
    await expect(svc.setRateLimitPolicy({ policyKey: "register", limit: 2.5, windowSeconds: 60, actorId: "a", reason: "r" })).rejects.toMatchObject({ status: 422 });
  });
  it("creates a new version and audits with the reason", async () => {
    policies = [{ policyKey: "register", version: 2, status: "ACTIVE" }];
    await svc.setRateLimitPolicy({ policyKey: "register", limit: 3, windowSeconds: 60, actorId: "a", reason: "attack" });
    expect(policies.at(-1)).toMatchObject({ policyKey: "register", version: 3, limit: 3, createdById: "a" });
    expect(audits[0]).toMatchObject({ action: "RISK_CONFIGURATION_CHANGED", meta: { policyKey: "register", version: 3, reason: "attack" } });
  });
});
