import { describe, it, expect, vi, beforeEach } from "vitest";

// On a fresh production database there is no AppSettings row (id 1) until something creates it. The scheduled reconciliation and the rollout-stage
// change used `update`, which throws on a missing row: the daily tick was marked FAILED 13 days in a row. Both must work with no row.
const db = vi.hoisted(() => ({ settings: null as Record<string, unknown> | null, upserts: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: {
      findUnique: async () => db.settings,
      update: async () => { throw new Error("No record was found for an update."); },
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        db.upserts.push(args);
        db.settings = db.settings ? { ...db.settings, ...args.update } : { id: 1, ...args.create };
        return db.settings;
      },
    },
    reconciliationRun: { create: async () => ({ id: "run1" }), update: async () => ({}) },
    payment: { findMany: async () => [] },
    reconciliationItem: { create: async () => ({}) },
    paymentRolloutEvent: { create: async (a: { data: Record<string, unknown> }) => { db.events.push(a.data); return a.data; } },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => undefined }));
vi.mock("@/lib/finance/providers/registry", () => ({ getProvider: () => ({}) }));

import { runScheduledReconciliation } from "@/lib/finance/reconciliation";
import { changeRolloutStage } from "@/lib/finance/rollout";

beforeEach(() => { db.settings = null; db.upserts = []; db.events = []; });

describe("AppSettings row missing", () => {
  it("scheduled reconciliation runs and records the time instead of throwing", async () => {
    const result = await runScheduledReconciliation();
    expect(result).toMatchObject({ ran: true, totalChecked: 0 });
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].create).toMatchObject({ id: 1 });
    expect(db.settings?.lastScheduledReconciliationAt).toBeInstanceOf(Date);
  });

  it("is then 'not yet due' on the next call (the stamp was really saved)", async () => {
    await runScheduledReconciliation();
    expect(await runScheduledReconciliation()).toEqual({ ran: false, reason: "Not yet due" });
  });

  it("changing the payment rollout stage works with no settings row", async () => {
    await changeRolloutStage({ toStage: "SANDBOX", reason: "first step", actorId: "a1" });
    expect(db.settings?.paymentRolloutStage).toBe("SANDBOX");
    expect(db.events).toHaveLength(1);
  });
});
