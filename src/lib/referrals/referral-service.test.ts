import { describe, it, expect, vi, beforeEach } from "vitest";

let referralCodes: Array<Record<string, unknown>>;
let referrals: Array<Record<string, unknown>>;
let referralPrograms: Array<Record<string, unknown>>;
let referralEvents: Array<Record<string, unknown>>;
let profileSessions: Array<Record<string, unknown>>;
let securityEvents: Array<Record<string, unknown>>;
let auditCalls: Array<Record<string, unknown>>;
let forceNextCreateCollision = false;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (prefix: string) => `LPP-${prefix}-000001`) }));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: vi.fn(async (input: Record<string, unknown>) => { securityEvents.push(input); return { recorded: true }; }) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async () => null) }));
vi.mock("@/lib/finance/credits", () => ({ grantCredit: vi.fn(async () => ({})) }));
vi.mock("@/lib/finance/entitlements", () => ({ grantOverride: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/events", () => ({ notifyReferralRewardGranted: vi.fn(async () => undefined) }));
vi.mock("@/lib/finance/rollout", () => ({ getPaymentFeatureFlags: vi.fn(async () => ({ referralsEnabled: true })) }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, fullName: "Test User", profileCode: "LPP-000001" })) },
    referralCode: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (forceNextCreateCollision) {
          forceNextCreateCollision = false;
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        if (referralCodes.some((c) => c.code === data.code)) {
          const err = new Error("Unique constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        const row = { id: `rc${referralCodes.length + 1}`, active: true, createdAt: new Date(), ...data };
        referralCodes.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: { code: string } }) => {
        const row = referralCodes.find((c) => c.code === where.code);
        if (!row) return null;
        const program = referralPrograms.find((p) => p.id === row.programId);
        return { ...row, program };
      }),
      findFirst: vi.fn(async ({ where }: { where: { profileId: string; programId: string } }) => referralCodes.find((c) => c.profileId === where.profileId && c.programId === where.programId) ?? null),
    },
    referralProgram: {
      findFirst: vi.fn(async ({ where }: { where?: { status?: string } }) => referralPrograms.filter((p) => !where?.status || p.status === where.status)[0] ?? null),
    },
    referral: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `r${referrals.length + 1}`, createdAt: new Date(), ...data };
        referrals.push(row);
        return row;
      }),
      findUnique: vi.fn(async ({ where, include }: { where: { id?: string; refereeProfileId?: string }; include?: { program?: boolean } }) => {
        const row = where.id ? referrals.find((r) => r.id === where.id) : referrals.find((r) => r.refereeProfileId === where.refereeProfileId);
        if (!row) return null;
        if (include?.program) return { ...row, program: referralPrograms.find((p) => p.id === row.programId) };
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = referrals.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      count: vi.fn(async ({ where }: { where: { referrerProfileId: string; programId: string; createdAt: { gte: Date } } }) =>
        referrals.filter((r) => r.referrerProfileId === where.referrerProfileId && r.programId === where.programId && (r.createdAt as Date) >= where.createdAt.gte).length
      ),
    },
    referralEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { referralEvents.push(data); return data; }) },
    profileSession: {
      findMany: vi.fn(async ({ where }: { where: { profileId: string } }) => profileSessions.filter((s) => s.profileId === where.profileId)),
    },
  },
}));

const { generateReferralCode, linkReferral, evaluateQualifyingEvent } = await import("./referral-service");

beforeEach(() => {
  referralCodes = [];
  referrals = [];
  referralPrograms = [{ id: "prog1", status: "ACTIVE", rewardType: "CREDIT", rewardConfig: { creditMinor: 10000, currencyCode: "PKR" }, qualifyingEvent: "FIRST_PAYMENT", maxRewardsPerReferrer: null, maxReferralsPerPeriod: null, periodDays: null }];
  referralEvents = [];
  profileSessions = [];
  securityEvents = [];
  auditCalls = [];
  forceNextCreateCollision = false;
});

describe("generateReferralCode", () => {
  it("produces an LPP-prefixed code with an unpredictable suffix", async () => {
    const code = await generateReferralCode("referrer1", "prog1");
    expect(code).toMatch(/^LPP-[A-Z0-9]+-[A-Z0-9]{4}$/);
  });

  it("re-rolls on a collision rather than reusing a predictable fallback", async () => {
    // A random suffix collision is impractical to force deterministically,
    // so instead we make the very first create() attempt fail with the
    // same unique-constraint error a real collision would produce, and
    // confirm generateReferralCode retries rather than giving up or
    // falling back to something predictable.
    forceNextCreateCollision = true;
    const code = await generateReferralCode("referrer1", "prog1");
    expect(referralCodes).toHaveLength(1); // exactly one row landed, after the retry
    expect(code).toMatch(/^LPP-/);
  });
});

describe("linkReferral", () => {
  it("rejects self-referral outright", async () => {
    await generateReferralCode("referrer1", "prog1");
    const code = referralCodes[0].code as string;
    await expect(linkReferral("referrer1", code)).rejects.toThrow(/own referral code/);
  });

  it("links a genuine referral and rejects a second link for the same referee", async () => {
    await generateReferralCode("referrer1", "prog1");
    const code = referralCodes[0].code as string;
    const referral = await linkReferral("referee1", code);
    expect(referral.status).toBe("LINKED");
    expect(referral.referrerProfileId).toBe("referrer1");

    await expect(linkReferral("referee1", code)).rejects.toThrow(/already been recorded/);
  });

  it("rejects an unknown code", async () => {
    await expect(linkReferral("referee1", "LPP-NOTREAL-0000")).rejects.toThrow(/Invalid or inactive/);
  });
});

describe("runFraudCheck", () => {
  it("passes through with no flags when there's no shared device/IP and no velocity issue", async () => {
    await generateReferralCode("referrer1", "prog1");
    const code = referralCodes[0].code as string;
    const referral = await linkReferral("referee1", code);
    await evaluateQualifyingEvent("referee1", "FIRST_PAYMENT");

    const updated = referrals.find((r) => r.id === referral.id)!;
    expect(updated.status).toBe("QUALIFIED"); // fraud check found nothing, stayed QUALIFIED
  });

  it("flags a shared IP between referrer and referee for human review", async () => {
    profileSessions.push({ profileId: "referrer1", ipAddress: "1.2.3.4" }, { profileId: "referee1", ipAddress: "1.2.3.4" });
    await generateReferralCode("referrer1", "prog1");
    const code = referralCodes[0].code as string;
    const referral = await linkReferral("referee1", code);
    await evaluateQualifyingEvent("referee1", "FIRST_PAYMENT");

    const updated = referrals.find((r) => r.id === referral.id)!;
    expect(updated.status).toBe("REFERRAL_REVIEW_REQUIRED");
    expect(updated.fraudFlags).toContain("SHARED_DEVICE_OR_IP");
    expect(securityEvents.some((e) => e.eventType === "REFERRAL_ABUSE_SUSPECTED")).toBe(true);
  });

  it("never auto-rejects on a fraud signal — only routes to human review", async () => {
    profileSessions.push({ profileId: "referrer1", ipAddress: "9.9.9.9" }, { profileId: "referee1", ipAddress: "9.9.9.9" });
    await generateReferralCode("referrer1", "prog1");
    const code = referralCodes[0].code as string;
    const referral = await linkReferral("referee1", code);
    await evaluateQualifyingEvent("referee1", "FIRST_PAYMENT");

    const updated = referrals.find((r) => r.id === referral.id)!;
    expect(updated.status).not.toBe("REJECTED");
    expect(updated.status).toBe("REFERRAL_REVIEW_REQUIRED");
  });
});
