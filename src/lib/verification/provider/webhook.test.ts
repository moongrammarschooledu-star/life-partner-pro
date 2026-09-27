import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeEventRow { id: string; provider: string; providerEventId: string; eventType: string; payloadHash: string; signatureValid: boolean; processed: boolean; processedAt: Date | null; }
interface FakeVerification { id: string; profileId: string; providerSessionId: string | null; providerStatus: string | null; status: string; }

let events: Map<string, FakeEventRow>; // keyed by `${provider}:${providerEventId}`
let verifications: Map<string, FakeVerification>; // keyed by id
let auditCalls: Record<string, unknown>[];
let statusCalls: { profileId: string; status: string }[];
let idCounter = 0;

let mockVerifyWebhook: (rawBody: string, sig: string | null) => boolean;
let mockParseEvent: (rawBody: string) => { providerEventId: string; eventType: string; sessionId: string | null; status: string | null } | null;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/verification/status", () => ({
  setVerificationStatus: vi.fn(async (profileId: string, status: string) => {
    statusCalls.push({ profileId, status });
  }),
}));
vi.mock("./index", () => ({
  getVerificationProvider: () => ({
    name: "mock",
    verifyWebhook: (rawBody: string, sig: string | null) => mockVerifyWebhook(rawBody, sig),
    parseWebhookEvent: (rawBody: string) => mockParseEvent(rawBody),
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    verificationProviderEvent: {
      create: vi.fn(async ({ data }: { data: Omit<FakeEventRow, "id" | "processed" | "processedAt"> }) => {
        const key = `${data.provider}:${data.providerEventId}`;
        if (events.has(key)) throw new Error("Unique constraint violation");
        const row: FakeEventRow = { id: `evt${++idCounter}`, processed: false, processedAt: null, ...data };
        events.set(key, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeEventRow> }) => {
        const row = [...events.values()].find((e) => e.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    profileVerification: {
      findFirst: vi.fn(async ({ where }: { where: { providerSessionId: string } }) =>
        [...verifications.values()].find((v) => v.providerSessionId === where.providerSessionId) ?? null
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeVerification> }) => {
        const v = verifications.get(where.id)!;
        Object.assign(v, data);
        return v;
      }),
    },
  },
}));

const { processVerificationWebhook } = await import("./webhook");

beforeEach(() => {
  events = new Map();
  verifications = new Map([["v1", { id: "v1", profileId: "p1", providerSessionId: "sess1", providerStatus: null, status: "VERIFICATION_PENDING" }]]);
  auditCalls = [];
  statusCalls = [];
  idCounter = 0;
  mockVerifyWebhook = () => true;
  mockParseEvent = (rawBody) => JSON.parse(rawBody);
});

describe("processVerificationWebhook", () => {
  it("rejects an invalid signature without ever touching verification state", async () => {
    mockVerifyWebhook = () => false;
    const result = await processVerificationWebhook("{}", "bad-sig");
    expect(result).toEqual({ ok: false, status: 401, error: "Invalid signature" });
    expect(statusCalls).toHaveLength(0);
    expect(auditCalls[0]).toMatchObject({ action: "PROVIDER_WEBHOOK_REJECTED" });
  });

  it("rejects a malformed payload", async () => {
    mockParseEvent = () => null;
    const result = await processVerificationWebhook("not json", "sig");
    expect(result).toEqual({ ok: false, status: 400, error: "Invalid payload" });
  });

  it("processes a valid event and moves a matched verification toward UNDER_REVIEW on APPROVED, never straight to VERIFIED", async () => {
    const result = await processVerificationWebhook(
      JSON.stringify({ eventId: "evt1", eventType: "verification.updated", sessionId: "sess1", status: "APPROVED" }),
      "sig"
    );
    expect(result).toEqual({ ok: true });
    expect(verifications.get("v1")!.providerStatus).toBe("APPROVED");
    expect(statusCalls).toEqual([{ profileId: "p1", status: "UNDER_REVIEW" }]);
    expect([...events.values()][0].processed).toBe(true);
  });

  it("moves a REJECTED provider result to UNDER_REVIEW too — never an automatic rejection", async () => {
    await processVerificationWebhook(JSON.stringify({ eventId: "evt2", eventType: "verification.updated", sessionId: "sess1", status: "REJECTED" }), "sig");
    expect(statusCalls).toEqual([{ profileId: "p1", status: "UNDER_REVIEW" }]);
  });

  it("does not change internal status for PENDING/IN_PROGRESS — only records providerStatus", async () => {
    await processVerificationWebhook(JSON.stringify({ eventId: "evt3", eventType: "verification.updated", sessionId: "sess1", status: "IN_PROGRESS" }), "sig");
    expect(statusCalls).toHaveLength(0);
    expect(verifications.get("v1")!.providerStatus).toBe("IN_PROGRESS");
  });

  it("is idempotent — the same providerEventId delivered twice is only processed once", async () => {
    const payload = JSON.stringify({ eventId: "evt-dup", eventType: "verification.updated", sessionId: "sess1", status: "APPROVED" });
    const first = await processVerificationWebhook(payload, "sig");
    const second = await processVerificationWebhook(payload, "sig");
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true, duplicate: true });
    expect(statusCalls).toHaveLength(1); // not reprocessed
  });

  it("ignores an event for a session with no matching ProfileVerification (no crash, no state change)", async () => {
    const result = await processVerificationWebhook(
      JSON.stringify({ eventId: "evt4", eventType: "verification.updated", sessionId: "unknown-session", status: "APPROVED" }),
      "sig"
    );
    expect(result).toEqual({ ok: true });
    expect(statusCalls).toHaveLength(0);
  });
});
