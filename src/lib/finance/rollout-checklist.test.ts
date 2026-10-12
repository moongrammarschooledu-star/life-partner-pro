import { describe, it, expect, vi, beforeEach } from "vitest";

type Where = { status?: string | { in: string[] } };

const state = { payments: [] as { status: string }[] };

function matches(row: { status: string }, where?: Where) {
  const s = where?.status;
  if (!s) return true;
  return typeof s === "string" ? row.status === s : s.in.includes(row.status);
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findFirst: async ({ where }: { where?: Where }) => state.payments.find((p) => matches(p, where)) ?? null },
    order: { findFirst: async () => null },
    refund: { findFirst: async () => null },
    paymentWebhookEvent: { findFirst: async () => null },
    subscription: { findFirst: async () => null },
    invoice: { findFirst: async () => null },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/case-code", () => ({ nextCaseNumber: vi.fn() }));
vi.mock("@/lib/case-sla", () => ({ computeSlaDueDates: vi.fn() }));
vi.mock("@/lib/finance/providers/registry", () => ({ getProvider: vi.fn() }));
vi.mock("@/lib/ops/system-control", () => ({ isEmergencyDisabled: vi.fn() }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn() }));

import { getSandboxReadinessChecklist } from "./rollout";

describe("sandbox checklist: successfulPayment", () => {
  beforeEach(() => {
    state.payments = [];
  });

  it("is false when no payment ever succeeded", async () => {
    state.payments = [{ status: "FAILED" }, { status: "CANCELLED" }, { status: "PENDING" }];
    expect((await getSandboxReadinessChecklist()).successfulPayment).toBe(false);
  });

  it("is true for a paid payment", async () => {
    state.payments = [{ status: "PAID" }];
    expect((await getSandboxReadinessChecklist()).successfulPayment).toBe(true);
  });

  it("stays true after the only paid payment was refunded", async () => {
    state.payments = [{ status: "REFUNDED" }, { status: "FAILED" }];
    expect((await getSandboxReadinessChecklist()).successfulPayment).toBe(true);
  });

  it("stays true after a partial refund", async () => {
    state.payments = [{ status: "PARTIALLY_REFUNDED" }];
    expect((await getSandboxReadinessChecklist()).successfulPayment).toBe(true);
  });
});
