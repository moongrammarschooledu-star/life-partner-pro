import { describe, it, expect, vi, beforeEach } from "vitest";

let ruleResult: { resolved: boolean; value: { status: string } | null; reviewRequired: boolean; matchedRules: { id: string }[] };
let created: Record<string, unknown>[];
let auditCalls: Record<string, unknown>[];
let eventCalls: Record<string, unknown>[];
let notifyCalls: Record<string, unknown>[];
let seq = 0;

vi.mock("@/lib/compliance/rule-engine", () => ({ isCrossBorderTransferAllowed: vi.fn(async () => ruleResult) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-XFER-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (call: Record<string, unknown>) => { eventCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/notifications/notification-service", () => ({ notifyAdmins: vi.fn(async (call: Record<string, unknown>) => { notifyCalls.push(call); }) }));
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
  eventCalls = [];
  notifyCalls = [];
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

  it("never creates a task/notification for an ALLOWED transfer", async () => {
    ruleResult = { resolved: true, value: { status: "ALLOWED" }, reviewRequired: false, matchedRules: [{ id: "rule1" }] };
    await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "CONFIDENTIAL", dataType: "profile_data", purpose: "MATCHMAKING" });
    expect(eventCalls).toHaveLength(0);
    expect(notifyCalls).toHaveLength(0);
  });

  it("dispatches a JURISDICTION_REVIEW task and COMPLIANCE_JURISDICTION_UNKNOWN notification when status is UNKNOWN", async () => {
    await assessTransfer({ dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION", provider: "mock" });
    expect(eventCalls[0]).toMatchObject({ taskType: "JURISDICTION_REVIEW", resourceType: "CASE" });
    expect(notifyCalls[0]).toMatchObject({ type: "COMPLIANCE_JURISDICTION_UNKNOWN", roles: ["COMPLIANCE_MANAGER"] });
  });

  it("dispatches a TRANSFER_REVIEW task and COMPLIANCE_TRANSFER_REVIEW_REQUIRED notification when status is REVIEW_REQUIRED", async () => {
    await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION", provider: "mock" });
    expect(eventCalls[0]).toMatchObject({ taskType: "TRANSFER_REVIEW", priority: "NORMAL" });
    expect(notifyCalls[0]).toMatchObject({ type: "COMPLIANCE_TRANSFER_REVIEW_REQUIRED" });
  });

  it("uses HIGH priority for a BLOCKED transfer's task", async () => {
    ruleResult = { resolved: true, value: { status: "BLOCKED" }, reviewRequired: false, matchedRules: [{ id: "rule1" }] };
    await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "RESTRICTED", dataType: "biometric", purpose: "IDENTITY_VERIFICATION", provider: "mock" });
    expect(eventCalls[0]).toMatchObject({ taskType: "TRANSFER_REVIEW", priority: "HIGH" });
  });

  it("dedupes the task/notification per (provider, destination) pair per day — never floods on repeated calls", async () => {
    const dedupKeys: string[] = [];
    const { createFromEvent } = await import("@/lib/workflow/engine");
    vi.mocked(createFromEvent).mockImplementation(async (call) => {
      dedupKeys.push(call.dedupKey);
      // Simulate the real dedup: identical keys collapse to a single event.
      return dedupKeys.filter((k) => k === call.dedupKey).length === 1 ? ({ id: "task1" } as never) : null;
    });

    await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION", provider: "mock" });
    await assessTransfer({ sourceJurisdictionId: "j1", destJurisdictionCode: "US", dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION", provider: "mock" });

    expect(new Set(dedupKeys).size).toBe(1); // identical bucket -> identical dedup key both calls
  });
});
