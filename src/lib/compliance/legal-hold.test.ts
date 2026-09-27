import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeHold {
  id: string; profileId: string | null; recordType: string | null; recordId: string | null; reason: string;
  placedById: string; placedAt: Date; liftedById: string | null; liftedAt: Date | null; active: boolean;
  holdStatus: string; authority: string | null; dataClasses: string | null; scope: string | null; approvedById: string | null;
}

let holds: Map<string, FakeHold>;
let auditCalls: Record<string, unknown>[];
let gateCalls: Record<string, unknown>[];
let gateResult: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string };
let executedCalls: string[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (params: Record<string, unknown>) => { gateCalls.push(params); return gateResult; }),
  markApprovalExecuted: vi.fn(async (id: string) => { executedCalls.push(id); }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataHold: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = holds.get(where.id);
        if (!row) throw new Error("not found");
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = holds.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeHold;
        holds.set(where.id, updated);
        return updated;
      }),
      findMany: vi.fn(async ({ where }: { where: { holdStatus: string } }) => [...holds.values()].filter((h) => h.holdStatus === where.holdStatus)),
    },
  },
}));

const { requestHoldRelease, executeHoldRelease, listHoldsPendingRelease } = await import("./legal-hold");

const actor = { id: "admin1", name: "A", email: "a@x.com", role: "SUPER_ADMIN", permissions: [], sid: "s1" } as never;

function seedHold(overrides: Partial<FakeHold> = {}): FakeHold {
  const hold: FakeHold = {
    id: "hold1", profileId: "profile1", recordType: null, recordId: null, reason: "court order",
    placedById: "admin0", placedAt: new Date(), liftedById: null, liftedAt: null, active: true,
    holdStatus: "ACTIVE", authority: "Court Order #1", dataClasses: null, scope: null, approvedById: null,
    ...overrides,
  };
  holds.set(hold.id, hold);
  return hold;
}

beforeEach(() => {
  holds = new Map();
  auditCalls = [];
  gateCalls = [];
  executedCalls = [];
  gateResult = { requiresApproval: false };
});

describe("requestHoldRelease", () => {
  it("refuses to request release of an already-lifted hold", async () => {
    seedHold({ active: false, holdStatus: "RELEASED" });
    await expect(requestHoldRelease("hold1", actor, "reason")).rejects.toThrow();
  });

  it("refuses a duplicate release request while one is already pending", async () => {
    seedHold({ holdStatus: "RELEASE_PENDING" });
    await expect(requestHoldRelease("hold1", actor, "reason")).rejects.toThrow();
  });

  it("moves the hold to RELEASE_PENDING and keeps `active` true throughout — no early access", async () => {
    seedHold();
    gateResult = { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const result = await requestHoldRelease("hold1", actor, "case closed, releasing hold");

    expect(gateCalls[0]).toMatchObject({ actionType: "LEGAL_HOLD_RELEASE" });
    expect(result.requiresApproval).toBe(true);
    expect(result.status).toBe("ALREADY_PENDING");
    expect(holds.get("hold1")?.holdStatus).toBe("RELEASE_PENDING");
    expect(holds.get("hold1")?.active).toBe(true);
  });

  it("reports status READY_TO_EXECUTE (not undefined) once the gate has already cleared, so callers can tell it apart from a fresh pending request", async () => {
    seedHold();
    gateResult = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const result = await requestHoldRelease("hold1", actor, "reason");

    expect(result.requiresApproval).toBe(true);
    expect(result.status).toBe("READY_TO_EXECUTE");
  });
});

describe("executeHoldRelease", () => {
  it("refuses to execute when no release has been requested", async () => {
    seedHold();
    await expect(executeHoldRelease("hold1", actor)).rejects.toThrow();
  });

  it("actually lifts the hold only once RELEASE_PENDING, and marks it RELEASED", async () => {
    seedHold({ holdStatus: "RELEASE_PENDING" });
    const hold = await executeHoldRelease("hold1", actor, "ar1");

    expect(hold.active).toBe(false);
    expect(holds.get("hold1")?.holdStatus).toBe("RELEASED");
    expect(executedCalls).toContain("ar1");
    expect(auditCalls.some((c) => c.action === "LEGAL_HOLD_RELEASE_EXECUTED")).toBe(true);
  });
});

describe("listHoldsPendingRelease", () => {
  it("lists only holds awaiting release", async () => {
    seedHold({ id: "hold1", holdStatus: "RELEASE_PENDING" });
    seedHold({ id: "hold2", holdStatus: "ACTIVE" });

    const pending = await listHoldsPendingRelease();
    expect(pending.map((h) => h.id)).toEqual(["hold1"]);
  });
});
