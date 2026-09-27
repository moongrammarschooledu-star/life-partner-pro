import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakePolicy { id: string; policyKey: string; policyVersion: number; configuration: string; status: string; effectiveFrom: Date; effectiveTo: Date | null; createdById: string | null; }

let policies: FakePolicy[];
let auditCalls: Record<string, unknown>[];
let idCounter = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    verificationPolicy: {
      findFirst: vi.fn(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { policyVersion: "desc" } }) => {
        let matches = policies.filter((p) => p.policyKey === where.policyKey);
        if (where.status) matches = matches.filter((p) => p.status === where.status);
        if (orderBy?.policyVersion === "desc") matches = [...matches].sort((a, b) => b.policyVersion - a.policyVersion);
        return matches[0] ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakePolicy> }) => {
        const p = policies.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return p;
      }),
      create: vi.fn(async ({ data }: { data: Omit<FakePolicy, "id"> }) => {
        const p: FakePolicy = { id: `pol${++idCounter}`, ...data };
        policies.push(p);
        return p;
      }),
      findMany: vi.fn(async ({ where }: { where: { policyKey: string } }) => policies.filter((p) => p.policyKey === where.policyKey).sort((a, b) => b.policyVersion - a.policyVersion)),
    },
  },
}));

const { getEffectivePolicy, setPolicy, listPolicyHistory } = await import("./policy");

beforeEach(() => {
  policies = [];
  auditCalls = [];
  idCounter = 0;
});

describe("getEffectivePolicy", () => {
  it("returns the default when no policy row exists", async () => {
    const value = await getEffectivePolicy("identityVerification.enabled", false);
    expect(value).toBe(false);
  });

  it("returns the configured value once set", async () => {
    await setPolicy("identityVerification.enabled", true, "admin1");
    const value = await getEffectivePolicy("identityVerification.enabled", false);
    expect(value).toBe(true);
  });
});

describe("setPolicy", () => {
  it("creates version 1 on first set and audits it", async () => {
    const created = await setPolicy("reverification.intervalDays", 180, "admin1");
    expect(created).toMatchObject({ policyKey: "reverification.intervalDays", policyVersion: 1, status: "ACTIVE" });
    expect(auditCalls[0]).toMatchObject({ action: "VERIFICATION_POLICY_CHANGED", adminId: "admin1", meta: { policyKey: "reverification.intervalDays", policyVersion: 1 } });
  });

  it("never overwrites in place — a second set supersedes the first and creates version 2", async () => {
    await setPolicy("reverification.intervalDays", 180, "admin1");
    await setPolicy("reverification.intervalDays", 90, "admin2");
    const history = await listPolicyHistory("reverification.intervalDays");
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ policyVersion: 2, status: "ACTIVE" });
    expect(history[1]).toMatchObject({ policyVersion: 1, status: "SUPERSEDED" });
    expect(history[1].effectiveTo).not.toBeNull();
  });
});
