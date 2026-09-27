import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeDoc {
  id: string; documentType: string; version: string; jurisdictionId: string | null; effectiveDate: Date;
  retirementDate: Date | null; language: string; contentReference: string; approvalStatus: string; createdById: string | null;
}

let docs: Map<string, FakeDoc>;
let auditCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    legalDocumentVersion: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `doc${docs.size + 1}`, ...data } as FakeDoc;
        docs.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const existing = docs.get(where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as FakeDoc;
        docs.set(where.id, updated);
        return updated;
      }),
      findFirst: vi.fn(async ({ where }: { where: { documentType: string; jurisdictionId: string | null; language: string; approvalStatus: string } }) => {
        const matches = [...docs.values()]
          .filter((d) => d.documentType === where.documentType && d.jurisdictionId === where.jurisdictionId && d.language === where.language && d.approvalStatus === where.approvalStatus)
          .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
        return matches[0] ?? null;
      }),
      findMany: vi.fn(async () => [...docs.values()]),
    },
  },
}));

const { createDocumentVersion, publishDocumentVersion, retireDocumentVersion, getCurrentDocumentVersion } = await import("./documents");

beforeEach(() => {
  docs = new Map();
  auditCalls = [];
});

describe("createDocumentVersion", () => {
  it("always starts as DRAFT", async () => {
    const doc = await createDocumentVersion({ documentType: "PRIVACY_POLICY" as never, version: "1.0", contentReference: "s3://policies/v1" }, "admin1");
    expect(doc.approvalStatus).toBe("DRAFT");
  });
});

describe("getCurrentDocumentVersion", () => {
  it("returns nothing when no version has been published", async () => {
    await createDocumentVersion({ documentType: "PRIVACY_POLICY" as never, version: "1.0", contentReference: "ref" }, "admin1");
    const current = await getCurrentDocumentVersion("PRIVACY_POLICY" as never);
    expect(current).toBeNull();
  });

  it("prefers a jurisdiction-scoped published version over the global one", async () => {
    const global = await createDocumentVersion({ documentType: "PRIVACY_POLICY" as never, version: "1.0", contentReference: "ref-global" }, "admin1");
    await publishDocumentVersion(global.id, "admin1");
    const scoped = await createDocumentVersion({ documentType: "PRIVACY_POLICY" as never, version: "1.0-EU", jurisdictionId: "j1", contentReference: "ref-eu" }, "admin1");
    await publishDocumentVersion(scoped.id, "admin1");

    const current = await getCurrentDocumentVersion("PRIVACY_POLICY" as never, "j1");
    expect(current?.id).toBe(scoped.id);
  });

  it("falls back to the global published version when no jurisdiction-scoped one exists", async () => {
    const global = await createDocumentVersion({ documentType: "TERMS_OF_SERVICE" as never, version: "1.0", contentReference: "ref" }, "admin1");
    await publishDocumentVersion(global.id, "admin1");

    const current = await getCurrentDocumentVersion("TERMS_OF_SERVICE" as never, "j-unrelated");
    expect(current?.id).toBe(global.id);
  });
});

describe("retireDocumentVersion", () => {
  it("sets a retirementDate and RETIRED status", async () => {
    const doc = await createDocumentVersion({ documentType: "PRIVACY_POLICY" as never, version: "1.0", contentReference: "ref" }, "admin1");
    await publishDocumentVersion(doc.id, "admin1");
    const retired = await retireDocumentVersion(doc.id, "admin1");
    expect(retired.approvalStatus).toBe("RETIRED");
    expect(retired.retirementDate).toBeInstanceOf(Date);
  });
});
