import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeRule {
  id: string; ruleCode: string; jurisdictionId: string; subject: string; requirementType: string; description: string;
  sourceType: string; sourceTitle: string | null; sourceAuthority: string | null; sourceReference: string | null;
  sourceUrl: string | null; sourcePublicationDate: Date | null; internalReviewNote: string | null;
  effectiveFrom: Date; effectiveTo: Date | null; reviewDate: Date | null;
  status: string; ruleVersion: number; configuration: string;
  createdById: string | null; approvedById: string | null; approvalDate: Date | null;
}

let rules: Map<string, FakeRule>;
let seq = 0;
let auditCalls: Record<string, unknown>[];
let gateCalls: Record<string, unknown>[];
let gateResult: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string };
let executedCalls: string[];
let taskCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-CRULE-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createTask: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async (params: Record<string, unknown>) => { gateCalls.push(params); return gateResult; }),
  markApprovalExecuted: vi.fn(async (id: string) => { executedCalls.push(id); }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    complianceRule: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `rule${rules.size + 1}`, ...data } as FakeRule;
        rules.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = rules.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeRule;
        rules.set(where.id, updated);
        return updated;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rules.get(where.id);
        if (!row) throw new Error("not found");
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rules.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { jurisdictionId?: string; status?: string; reviewDate?: { lte: Date } } }) => {
        return [...rules.values()].filter(
          (r) =>
            (!where.jurisdictionId || r.jurisdictionId === where.jurisdictionId) &&
            (!where.status || r.status === where.status) &&
            (!where.reviewDate || (r.reviewDate && r.reviewDate <= where.reviewDate.lte))
        );
      }),
    },
  },
}));

const { createRule, updateDraftRule, submitRuleForReview, approveRule, activateRule, suspendRule, retireRule, listRulesDueForReview } = await import("./rules");

const actor = { id: "admin1", name: "A", email: "a@x.com", role: "COMPLIANCE_MANAGER", permissions: [], sid: "s1" } as never;

async function makeDraftRule() {
  return createRule(
    {
      jurisdictionId: "j1",
      subject: "verification.document.CNIC",
      requirementType: "AGE_MINIMUM",
      description: "test rule",
      sourceType: "LAW" as never,
      effectiveFrom: new Date("2026-01-01"),
      configuration: { minAge: 18 },
    },
    actor
  );
}

beforeEach(() => {
  rules = new Map();
  seq = 0;
  auditCalls = [];
  gateCalls = [];
  executedCalls = [];
  gateResult = { requiresApproval: false };
  taskCalls = [];
});

describe("createRule", () => {
  it("always starts a new rule as DRAFT", async () => {
    const rule = await makeDraftRule();
    expect(rule.status).toBe("DRAFT");
    expect(rule.ruleVersion).toBe(1);
  });
});

describe("state machine transitions", () => {
  it("DRAFT -> UNDER_REVIEW via submitRuleForReview", async () => {
    const rule = await makeDraftRule();
    const updated = await submitRuleForReview(rule.id, actor);
    expect(updated.status).toBe("UNDER_REVIEW");
  });

  it("creates a COMPLIANCE_REVIEW task when submitted for review", async () => {
    const rule = await makeDraftRule();
    await submitRuleForReview(rule.id, actor);
    expect(taskCalls[0]).toMatchObject({ taskType: "COMPLIANCE_REVIEW", resourceType: "CASE", resourceId: rule.id });
  });

  it("refuses to submit a rule that is not DRAFT", async () => {
    const rule = await makeDraftRule();
    await submitRuleForReview(rule.id, actor);
    await expect(submitRuleForReview(rule.id, actor)).rejects.toThrow();
  });

  it("approveRule requires UNDER_REVIEW status", async () => {
    const rule = await makeDraftRule();
    await expect(approveRule(rule.id, actor, "reason")).rejects.toThrow();
  });

  it("approveRule goes through the STEP-19 gate and only sets APPROVED once cleared", async () => {
    const rule = await makeDraftRule();
    await submitRuleForReview(rule.id, actor);
    const result = await approveRule(rule.id, actor, "legal review complete");
    expect(gateCalls[0]).toMatchObject({ actionType: "COMPLIANCE_RULE_APPROVAL" });
    expect(result.requiresApproval).toBe(false);
    expect(result.rule?.status).toBe("APPROVED");
    expect(result.rule?.approvedById).toBe("admin1");
  });

  it("does not set APPROVED while the gate is still pending", async () => {
    gateResult = { requiresApproval: true, status: "ALREADY_PENDING", approvalRequestId: "ar1", approvalCode: "LPP-APR-000001" };
    const rule = await makeDraftRule();
    await submitRuleForReview(rule.id, actor);
    const result = await approveRule(rule.id, actor, "reason");
    expect(result.requiresApproval).toBe(true);
    expect(rules.get(rule.id)?.status).toBe("UNDER_REVIEW");
    expect(executedCalls).toHaveLength(0);
  });

  it("activateRule requires APPROVED status and never bypasses approval", async () => {
    const rule = await makeDraftRule();
    await expect(activateRule(rule.id, actor)).rejects.toThrow();

    await submitRuleForReview(rule.id, actor);
    await approveRule(rule.id, actor, "reason");
    const activated = await activateRule(rule.id, actor);
    expect(activated.status).toBe("ACTIVE");
  });

  it("suspendRule requires ACTIVE status", async () => {
    const rule = await makeDraftRule();
    await expect(suspendRule(rule.id, actor, "reason")).rejects.toThrow();
  });

  it("retireRule refuses an already-retired rule", async () => {
    const rule = await makeDraftRule();
    await prismaDirectSetStatus(rule.id, "RETIRED");
    await expect(retireRule(rule.id, actor, "reason")).rejects.toThrow();
  });
});

describe("updateDraftRule", () => {
  it("allows editing while DRAFT", async () => {
    const rule = await makeDraftRule();
    const updated = await updateDraftRule(rule.id, { description: "revised" }, actor);
    expect(updated.description).toBe("revised");
  });

  it("refuses to edit an ACTIVE rule", async () => {
    const rule = await makeDraftRule();
    await submitRuleForReview(rule.id, actor);
    await approveRule(rule.id, actor, "reason");
    await activateRule(rule.id, actor);
    await expect(updateDraftRule(rule.id, { description: "sneaky edit" }, actor)).rejects.toThrow();
  });
});

describe("listRulesDueForReview", () => {
  it("only lists ACTIVE rules whose reviewDate has passed", async () => {
    const rule = await makeDraftRule();
    await submitRuleForReview(rule.id, actor);
    await approveRule(rule.id, actor, "reason");
    await activateRule(rule.id, actor);
    await prismaDirectSetReviewDate(rule.id, new Date("2020-01-01"));

    const due = await listRulesDueForReview(new Date("2026-01-01"));
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(rule.id);
  });
});

async function prismaDirectSetStatus(id: string, status: string) {
  const row = rules.get(id);
  if (row) rules.set(id, { ...row, status });
}
async function prismaDirectSetReviewDate(id: string, reviewDate: Date) {
  const row = rules.get(id);
  if (row) rules.set(id, { ...row, reviewDate });
}
