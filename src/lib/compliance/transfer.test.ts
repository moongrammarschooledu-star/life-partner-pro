import { describe, it, expect, vi, beforeEach } from "vitest";

let ruleResult: { resolved: boolean; value: { status: string } | null; reviewRequired: boolean; matchedRules: { id: string }[] };
let created: Record<string, unknown>[];
let auditCalls: Record<string, unknown>[];
let seq = 0;

vi.mock("@/lib/compliance/rule-engine", () => ({ isCrossBorderTransferAllowed: vi.fn(async () => ruleResult) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-XFER-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dataTransferAssessment: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `xfer${created.length + 1}`, ...data };
        created.push(row);
        return row;
      }),
    },
  },
}));

const { assessTransfer } = await import("./transfer");

beforeEach(() => {
  ruleResult = { resolved: false, value: null, reviewRequired: true, matchedRules: [] };
  created = [];
  auditCalls = [];
  seq = 0;
});

describe("assessTransfer", () => {
  it("is UNKNOWN when source/destination context is entirely missing, and still persists a row", async () => {
    const result = await assessTransfer({ dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION" });
    expect(result.status).toBe("UNKNOWN");
    expect(created).toHaveLength(1);
  });

  it("is REVIEW_REQUIRED when source/dest are given but no rule resolves the pair — never ALLOWED", async () => {
    const result = await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION" });
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("uses the rule's resolved status when one exists", async () => {
    ruleResult = { resolved: true, value: { status: "ALLOWED_WITH_CONTROLS" }, reviewRequired: false, matchedRules: [{ id: "rule1" }] };
    const result = await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "CONFIDENTIAL", dataType: "profile_data", purpose: "MATCHMAKING" });
    expect(result.status).toBe("ALLOWED_WITH_CONTROLS");
    expect(result.governingRuleId).toBe("rule1");
  });

  it("downgrades an ALLOWED rule to REVIEW_REQUIRED when consent is required but not obtained", async () => {
    ruleResult = { resolved: true, value: { status: "ALLOWED" }, reviewRequired: false, matchedRules: [{ id: "rule1" }] };
    const result = await assessTransfer({
      sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION",
      userConsentRequired: true, userConsentObtained: false,
    });
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("keeps ALLOWED when consent is required and obtained", async () => {
    ruleResult = { resolved: true, value: { status: "ALLOWED" }, reviewRequired: false, matchedRules: [{ id: "rule1" }] };
    const result = await assessTransfer({
      sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION",
      userConsentRequired: true, userConsentObtained: true,
    });
    expect(result.status).toBe("ALLOWED");
  });

  it("audits a BLOCKED assessment with the TRANSFER_BLOCKED action", async () => {
    ruleResult = { resolved: true, value: { status: "BLOCKED" }, reviewRequired: false, matchedRules: [{ id: "rule1" }] };
    await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "RESTRICTED", dataType: "biometric", purpose: "IDENTITY_VERIFICATION" });
    expect(auditCalls[0]).toMatchObject({ action: "TRANSFER_BLOCKED" });
  });
});
