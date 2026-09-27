import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeVerification { profileId: string; status: string; verificationVersion: number; }

let verifications: Map<string, FakeVerification>;
let statusCalls: { profileId: string; status: string; opts: unknown }[];
let auditCalls: Record<string, unknown>[];
let taskCalls: Record<string, unknown>[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/verification/status", () => ({
  setVerificationStatus: vi.fn(async (profileId: string, status: string, opts: unknown) => { statusCalls.push({ profileId, status, opts }); }),
}));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (call: Record<string, unknown>) => { taskCalls.push(call); return { id: "task1" }; }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { profileVerification: { findUnique: vi.fn(async ({ where }: { where: { profileId: string } }) => verifications.get(where.profileId) ?? null) } },
}));

const { checkAndTriggerReverification } = await import("./reverification-trigger");

beforeEach(() => {
  verifications = new Map([["p1", { profileId: "p1", status: "VERIFIED", verificationVersion: 1 }]]);
  statusCalls = [];
  auditCalls = [];
  taskCalls = [];
});

describe("checkAndTriggerReverification", () => {
  it("does nothing for a harmless field change", async () => {
    await checkAndTriggerReverification("p1", ["city", "hobbies"]);
    expect(statusCalls).toHaveLength(0);
    expect(taskCalls).toHaveLength(0);
  });

  it("triggers reverification when an identity field changes on a VERIFIED profile", async () => {
    await checkAndTriggerReverification("p1", ["dateOfBirth"]);
    expect(statusCalls).toEqual([{ profileId: "p1", status: "RE_VERIFICATION_REQUIRED", opts: { reVerificationReason: "Identity-related field changed: dateOfBirth" } }]);
    expect(auditCalls[0]).toMatchObject({ action: "REVERIFICATION_TRIGGERED", targetProfileId: "p1" });
    expect(taskCalls[0]).toMatchObject({ taskType: "VERIFICATION_REVIEW", resourceId: "p1" });
  });

  it("does not trigger for an identity field change on a profile that isn't currently VERIFIED", async () => {
    verifications.set("p1", { profileId: "p1", status: "VERIFICATION_PENDING", verificationVersion: 1 });
    await checkAndTriggerReverification("p1", ["fullName"]);
    expect(statusCalls).toHaveLength(0);
  });

  it("does not trigger when there is no verification row at all", async () => {
    verifications.clear();
    await checkAndTriggerReverification("p1", ["email"]);
    expect(statusCalls).toHaveLength(0);
  });

  it("triggers on a mix that includes at least one identity field", async () => {
    await checkAndTriggerReverification("p1", ["city", "mobileNumber"]);
    expect(statusCalls).toHaveLength(1);
  });
});
