import { describe, it, expect, vi, beforeEach } from "vitest";

let auditCalls: Record<string, unknown>[];
let jurisdictionRow: { id: string; countryCode: string } | null;
let processorRow: { country: string } | null;
let assessTransferCalls: Record<string, unknown>[];
let assessTransferImpl: () => Promise<unknown>;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("./index", () => ({
  getVerificationProvider: vi.fn(() => ({
    name: "mock",
    createSession: vi.fn(async () => ({ sessionId: "sess1", providerReference: "ref1", redirectUrl: null, instructions: "do the thing" })),
  })),
  isIdentityVerificationEnabled: vi.fn(() => true),
  VerificationProviderNotConfiguredError: class VerificationProviderNotConfiguredError extends Error {},
}));
vi.mock("@/lib/compliance/transfer", () => ({
  assessTransfer: vi.fn(async (input: Record<string, unknown>) => {
    assessTransferCalls.push(input);
    return assessTransferImpl();
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profileVerification: { upsert: vi.fn(async () => ({})) },
    jurisdiction: { findFirst: vi.fn(async () => jurisdictionRow) },
    complianceProcessor: { findFirst: vi.fn(async () => processorRow) },
  },
}));

const { createProviderSession } = await import("./session");

beforeEach(() => {
  auditCalls = [];
  jurisdictionRow = null;
  processorRow = null;
  assessTransferCalls = [];
  assessTransferImpl = async () => ({ status: "UNKNOWN" });
});

describe("createProviderSession", () => {
  it("still creates the session and never throws when the transfer assessment fails entirely", async () => {
    assessTransferImpl = async () => { throw new Error("assessment db error"); };
    const session = await createProviderSession("p1", "CNIC", "Pakistan");
    expect(session.sessionId).toBe("sess1");
  });

  it("STEP 23 Add-on §19 — assesses the transfer to the provider's country as HIGHLY_SENSITIVE identity data", async () => {
    jurisdictionRow = { id: "j1", countryCode: "Pakistan" };
    processorRow = { country: "US" };

    await createProviderSession("p1", "CNIC", "Pakistan");

    expect(assessTransferCalls).toHaveLength(1);
    expect(assessTransferCalls[0]).toMatchObject({
      sourceJurisdictionId: "j1",
      destJurisdictionCode: "US",
      dataClass: "HIGHLY_SENSITIVE",
      dataType: "identity_document",
      purpose: "IDENTITY_VERIFICATION",
      provider: "mock",
    });
  });

  it("passes undefined (not a guessed value) for either side when jurisdiction or processor country can't be resolved", async () => {
    jurisdictionRow = null;
    processorRow = null;

    await createProviderSession("p1", "CNIC", "Pakistan");

    expect(assessTransferCalls[0]).toMatchObject({ sourceJurisdictionId: undefined, destJurisdictionCode: undefined });
  });
});
