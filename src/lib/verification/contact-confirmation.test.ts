import { describe, it, expect, vi, beforeEach } from "vitest";

// Confirming a contact item by hand (call / WhatsApp) counts as verified; a code that cannot be delivered is not promised to the customer.

const verificationRow = { current: {} as Record<string, unknown> };
const itemRow = { current: {} as Record<string, unknown> };
const verificationUpdates: Array<Record<string, unknown>> = [];
const audits: Array<Record<string, unknown>> = [];
const recomputed: string[] = [];
const smsReal = { current: true };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profileVerification: {
      findUnique: async () => ({ id: "v1", ...verificationRow.current }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        verificationUpdates.push(data);
        return {};
      },
    },
    verificationItem: {
      findUnique: async () => ({ ...itemRow.current }),
      update: async ({ data }: { data: { status: string } }) => ({ itemKey: "x", status: data.status }),
    },
    profile: { findUnique: async () => ({ id: "p1", softDeleted: false, contact: { mobileNumber: "0300 1234567" } }) },
  },
}));
vi.mock("@/lib/route-guard", async () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return { requireAdmin: async () => ({ id: "admin1", permissions: [] }), handleApiError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }), ApiError };
});
vi.mock("@/lib/verification-access", () => ({ assertVerificationAccess: () => undefined }));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: Record<string, unknown>) => void audits.push(a) }));
vi.mock("@/lib/verification/status", () => ({ recomputeStoredCompleteness: async (id: string) => void recomputed.push(id) }));
vi.mock("@/lib/ops/guards", () => ({ blockedResponse: async () => null }));
vi.mock("@/lib/security/rate-limit-policy", () => ({ enforceConfiguredLimit: async () => null }));
vi.mock("@/lib/require-applicant", () => ({ requireApplicantProfileId: async () => "p1" }));
vi.mock("@/lib/verification/otp-service", () => ({ sendOtp: async () => ({ destinationMasked: "+92•••4567" }) }));
vi.mock("@/lib/verification/contact-code", () => ({ channelIsReal: async () => smsReal.current }));

const { PATCH } = await import("@/app/api/admin/profiles/[id]/verification/checklist/route");
const { POST: sendPhoneCode } = await import("@/app/api/verify/phone/send/route");

const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "p1" }) });

beforeEach(() => {
  verificationRow.current = { phoneVerifiedAt: null, emailVerifiedAt: null, whatsappVerifiedAt: null };
  itemRow.current = { status: "PENDING", completedById: null };
  verificationUpdates.length = 0;
  audits.length = 0;
  recomputed.length = 0;
  smsReal.current = true;
});

describe("an administrator confirms a contact item", () => {
  it("ticking mobile / WhatsApp / e-mail records the verification and refreshes completeness", async () => {
    for (const [itemKey, field] of [["mobile_verified", "phoneVerifiedAt"], ["whatsapp_verified", "whatsappVerifiedAt"], ["email_verified", "emailVerifiedAt"]] as const) {
      verificationUpdates.length = 0;
      expect((await patch({ itemKey, status: "COMPLETED" })).status).toBe(200);
      expect(verificationUpdates[0][field]).toBeInstanceOf(Date);
    }
    expect(recomputed).toHaveLength(3);
    expect(audits[0]).toMatchObject({ action: "PROFILE_EDITED", adminId: "admin1", meta: { sections: ["verification-contact"], itemKey: "mobile_verified", status: "COMPLETED" } });
  });

  it("does not overwrite a confirmation the person already made", async () => {
    verificationRow.current = { phoneVerifiedAt: new Date("2026-10-01T00:00:00Z"), emailVerifiedAt: null, whatsappVerifiedAt: null };
    await patch({ itemKey: "mobile_verified", status: "COMPLETED" });
    expect(verificationUpdates).toHaveLength(0);
  });

  it("taking back a tick an administrator gave clears it", async () => {
    verificationRow.current = { phoneVerifiedAt: new Date(), emailVerifiedAt: null, whatsappVerifiedAt: null };
    itemRow.current = { status: "COMPLETED", completedById: "admin1" };
    await patch({ itemKey: "mobile_verified", status: "PENDING" });
    expect(verificationUpdates[0]).toEqual({ phoneVerifiedAt: null });
  });

  it("never clears a confirmation the person made with a code", async () => {
    verificationRow.current = { phoneVerifiedAt: new Date(), emailVerifiedAt: null, whatsappVerifiedAt: null };
    itemRow.current = { status: "COMPLETED", completedById: null }; // completed by the code flow
    await patch({ itemKey: "mobile_verified", status: "PENDING" });
    expect(verificationUpdates).toHaveLength(0);
  });

  it("other checklist items do not touch the contact verification", async () => {
    await patch({ itemKey: "name_reviewed", status: "COMPLETED" });
    expect(verificationUpdates).toHaveLength(0);
    expect(recomputed).toHaveLength(0);
  });
});

describe("the customer's mobile verification code", () => {
  it("is refused with an honest message when no real SMS provider exists", async () => {
    smsReal.current = false;
    const res = await sendPhoneCode(new Request("http://x/api", { method: "POST" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/phone or WhatsApp/);
  });

  it("is sent when a real SMS provider exists", async () => {
    const res = await sendPhoneCode(new Request("http://x/api", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
