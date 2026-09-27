import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeProcessor {
  id: string; processorCode: string; name: string; serviceType: string; legalEntity: string | null; country: string;
  processingRegions: string; dataTypes: string; subprocessors: string | null; transferMechanism: string | null;
  contractStatus: string; complianceStatus: string; lastReviewedAt: Date | null; nextReviewDue: Date | null;
}
interface FakeAgreement {
  id: string; agreementCode: string; processorId: string; agreementType: string; agreementStatus: string;
  effectiveDate: Date | null; expiryDate: Date | null; jurisdictionId: string | null; dataCategories: string;
  subprocessorTerms: string | null; securityTerms: string | null; transferTerms: string | null; approvedById: string | null;
  createdAt: Date;
}

let processors: Map<string, FakeProcessor>;
let agreements: Map<string, FakeAgreement>;
let seq = 0;
let auditCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    complianceProcessor: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `proc${processors.size + 1}`, ...data } as FakeProcessor;
        processors.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = processors.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeProcessor;
        processors.set(where.id, updated);
        return updated;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => processors.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where: { serviceType?: string; complianceStatus?: string; nextReviewDue?: { lte: Date } } }) => {
        return [...processors.values()].filter(
          (p) =>
            (!where.serviceType || p.serviceType === where.serviceType) &&
            (!where.complianceStatus || p.complianceStatus === where.complianceStatus) &&
            (!where.nextReviewDue || (p.nextReviewDue && p.nextReviewDue <= where.nextReviewDue.lte))
        );
      }),
    },
    processorAgreement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `agr${agreements.size + 1}`, createdAt: new Date(), ...data } as FakeAgreement;
        agreements.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = agreements.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeAgreement;
        agreements.set(where.id, updated);
        return updated;
      }),
      findMany: vi.fn(async ({ where }: { where: { processorId: string } }) => [...agreements.values()].filter((a) => a.processorId === where.processorId)),
    },
  },
}));

const { createProcessor, recordProcessorReview, listProcessorsDueForReview, createAgreement, approveAgreement, listAgreementsForProcessor } = await import("./processors");

const actor = { id: "admin1", name: "A", email: "a@x.com", role: "COMPLIANCE_MANAGER", permissions: [], sid: "s1" } as never;

beforeEach(() => {
  processors = new Map();
  agreements = new Map();
  seq = 0;
  auditCalls = [];
});

describe("createProcessor", () => {
  it("always starts complianceStatus at REVIEW_REQUIRED, never COMPLIANT — even with data suggesting otherwise", async () => {
    const processor = await createProcessor(
      { name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", country: "US", processingRegions: ["US"], dataTypes: ["identity_document"] },
      actor
    );
    expect(processor.complianceStatus).toBe("REVIEW_REQUIRED");
    expect(processor.contractStatus).toBe("NOT_RECORDED");
  });

  it("audits PROCESSOR_CREATED", async () => {
    await createProcessor({ name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", country: "US", processingRegions: ["US"], dataTypes: [] }, actor);
    expect(auditCalls[0]).toMatchObject({ action: "PROCESSOR_CREATED" });
  });
});

describe("recordProcessorReview", () => {
  it("is the only path that changes complianceStatus, and requires an explicit reviewer decision", async () => {
    const processor = await createProcessor({ name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", country: "US", processingRegions: [], dataTypes: [] }, actor);
    const reviewed = await recordProcessorReview(processor.id, "COMPLIANT", actor, "SOC2 + contract reviewed by legal", new Date("2027-01-01"));
    expect(reviewed.complianceStatus).toBe("COMPLIANT");
    expect(reviewed.lastReviewedAt).toBeInstanceOf(Date);
    expect(auditCalls.find((c) => c.action === "PROCESSOR_REVIEWED")).toMatchObject({ meta: expect.objectContaining({ complianceStatus: "COMPLIANT" }) });
  });
});

describe("listProcessorsDueForReview", () => {
  it("only lists processors whose nextReviewDue has passed", async () => {
    const p1 = await createProcessor({ name: "Due", serviceType: "EMAIL", country: "US", processingRegions: [], dataTypes: [] }, actor);
    await recordProcessorReview(p1.id, "REVIEW_REQUIRED", actor, "note", new Date("2020-01-01"));
    const p2 = await createProcessor({ name: "Not due", serviceType: "SMS", country: "US", processingRegions: [], dataTypes: [] }, actor);
    await recordProcessorReview(p2.id, "REVIEW_REQUIRED", actor, "note", new Date("2030-01-01"));

    const due = await listProcessorsDueForReview(new Date("2026-01-01"));
    expect(due.map((p) => p.id)).toEqual([p1.id]);
  });
});

describe("agreements", () => {
  it("creates an agreement in DRAFT status", async () => {
    const processor = await createProcessor({ name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", country: "US", processingRegions: [], dataTypes: [] }, actor);
    const agreement = await createAgreement({ processorId: processor.id, agreementType: "DPA", dataCategories: ["identity_document"] }, actor);
    expect(agreement.agreementStatus).toBe("DRAFT");
  });

  it("approveAgreement records the approving admin", async () => {
    const processor = await createProcessor({ name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", country: "US", processingRegions: [], dataTypes: [] }, actor);
    const agreement = await createAgreement({ processorId: processor.id, agreementType: "DPA", dataCategories: [] }, actor);
    const approved = await approveAgreement(agreement.id, actor);
    expect(approved.agreementStatus).toBe("APPROVED");
    expect(approved.approvedById).toBe("admin1");
  });

  it("listAgreementsForProcessor scopes to the given processor only", async () => {
    const p1 = await createProcessor({ name: "P1", serviceType: "EMAIL", country: "US", processingRegions: [], dataTypes: [] }, actor);
    const p2 = await createProcessor({ name: "P2", serviceType: "SMS", country: "US", processingRegions: [], dataTypes: [] }, actor);
    await createAgreement({ processorId: p1.id, agreementType: "DPA", dataCategories: [] }, actor);
    await createAgreement({ processorId: p2.id, agreementType: "DPA", dataCategories: [] }, actor);

    const list = await listAgreementsForProcessor(p1.id);
    expect(list).toHaveLength(1);
    expect(list[0].processorId).toBe(p1.id);
  });
});
