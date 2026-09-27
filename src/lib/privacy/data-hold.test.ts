import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeHold { id: string; profileId: string | null; recordType: string | null; recordId: string | null; reason: string; placedById: string; active: boolean; liftedById: string | null; liftedAt: Date | null; }

let holds: Map<string, FakeHold>;
let auditCalls: Record<string, unknown>[];
let notifyCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/notifications/notification-service", () => ({ notifyAdmins: vi.fn(async (call: Record<string, unknown>) => { notifyCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataHold: {
      findFirst: vi.fn(async ({ where }: { where: { active: boolean; profileId?: string; recordType?: string; recordId?: string } }) =>
        [...holds.values()].find(
          (h) =>
            h.active === where.active &&
            (where.profileId === undefined || h.profileId === where.profileId) &&
            (where.recordType === undefined || (h.recordType === where.recordType && h.recordId === where.recordId))
        ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `hold${holds.size + 1}`, active: true, liftedById: null, liftedAt: null, ...data } as FakeHold;
        holds.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = holds.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeHold;
        holds.set(where.id, updated);
        return updated;
      }),
    },
  },
}));

const { hasActiveHold, placeHold, liftHold } = await import("./data-hold");

beforeEach(() => {
  holds = new Map();
  auditCalls = [];
  notifyCalls = [];
});

describe("placeHold", () => {
  it("creates an active hold and notifies compliance managers", async () => {
    const hold = await placeHold({ profileId: "p1", reason: "court order", placedById: "admin1" });
    expect(hold.active).toBe(true);
    expect(notifyCalls[0]).toMatchObject({ type: "COMPLIANCE_LEGAL_HOLD_ACTIVE", roles: ["COMPLIANCE_MANAGER"] });
    expect(auditCalls[0]).toMatchObject({ action: "DATA_HOLD_CREATED" });
  });
});

describe("hasActiveHold", () => {
  it("is true once a hold is placed, false after it's lifted", async () => {
    const hold = await placeHold({ profileId: "p1", reason: "x", placedById: "admin1" });
    expect(await hasActiveHold({ profileId: "p1" })).toBe(true);
    await liftHold(hold.id, "admin2");
    expect(await hasActiveHold({ profileId: "p1" })).toBe(false);
  });
});

describe("liftHold", () => {
  it("records who lifted it and when", async () => {
    const hold = await placeHold({ profileId: "p1", reason: "x", placedById: "admin1" });
    const lifted = await liftHold(hold.id, "admin2");
    expect(lifted.active).toBe(false);
    expect(lifted.liftedById).toBe("admin2");
    expect(lifted.liftedAt).toBeInstanceOf(Date);
    expect(auditCalls.some((c) => c.action === "DATA_HOLD_RELEASED")).toBe(true);
  });
});
