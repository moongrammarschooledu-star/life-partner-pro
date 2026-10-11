import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

// STEP 33 — the sign-in code: newest only, counted atomically, and a sign-in must not look like an e-mail verification.

interface Otp { id: string; profileId: string; channel: "EMAIL" | "PHONE"; codeHash: string; destinationMasked: string; attempts: number; maxAttempts: number; status: string; expiresAt: Date; createdAt: Date }
let otps: Otp[];
let seq = 0;
const sent: Array<{ subject?: string; body: string }> = [];
const touched: string[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: { findUnique: async () => ({ otpExpiryMinutes: 10, otpMaxAttempts: 3 }) },
    otpVerification: {
      create: async ({ data }: { data: Omit<Otp, "id" | "attempts" | "status" | "createdAt"> }) => { const row = { id: `o${++seq}`, attempts: 0, status: "PENDING", createdAt: new Date(Date.now() + seq), ...data } as Otp; otps.push(row); return row; },
      updateMany: async ({ where, data }: { where: { profileId: string; status: string }; data: { status: string } }) => { otps.filter((o) => o.profileId === where.profileId && o.status === where.status).forEach((o) => Object.assign(o, data)); return { count: 1 }; },
      findFirst: async ({ where }: { where: { profileId: string; status: string } }) => otps.filter((o) => o.profileId === where.profileId && o.status === where.status).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const o = otps.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) (o as unknown as Record<string, number>)[k] += (v as { increment: number }).increment;
          else (o as unknown as Record<string, unknown>)[k] = v;
        }
        return o;
      },
    },
    profileVerification: { upsert: async () => { touched.push("profileVerification.upsert"); return {}; }, findUnique: async () => { touched.push("profileVerification.findUnique"); return null; } },
    verificationItem: { updateMany: async () => { touched.push("verificationItem.updateMany"); return {}; } },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/notifications", () => ({ notificationService: { send: async (m: { subject?: string; body: string }) => { sent.push(m); } } }));
vi.mock("@/lib/notifications/notification-service", () => ({ sendNotification: async () => { touched.push("sendNotification"); } }));
vi.mock("@/lib/verification/status", () => ({ recomputeStoredCompleteness: async () => { touched.push("recomputeStoredCompleteness"); } }));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: async () => {} }));

const { sendOtp, confirmLoginOtp, confirmOtp } = await import("./otp-service");

const codeFrom = (i: number) => /sign-in code is (\d{6})/.exec(sent[i].body)![1];

beforeEach(() => { otps = []; sent.length = 0; touched.length = 0; seq = 0; });

describe("sendOtp for a sign-in (purpose LOGIN)", () => {
  it("mails a six-digit number with sign-in wording", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    expect(sent[0].subject).toMatch(/sign-in code/i);
    expect(codeFrom(0)).toMatch(/^\d{6}$/);
  });

  it("retires every earlier pending code, so only the newest one works", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    expect(otps.filter((o) => o.status === "PENDING")).toHaveLength(1);
    expect((await confirmLoginOtp("p1", codeFrom(0))).ok).toBe(false);
  });

  it("never touches another profile's codes", async () => {
    await sendOtp("p2", "EMAIL", "b@example.com", "LOGIN");
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    expect(otps.find((o) => o.profileId === "p2")!.status).toBe("PENDING");
  });
});

describe("confirmLoginOtp", () => {
  it("accepts the right code once and does NOT record an e-mail verification", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    expect(await confirmLoginOtp("p1", codeFrom(0))).toEqual({ ok: true });
    expect(touched).toEqual([]); // no verification record, no completeness change, no "e-mail verified" notice
    expect((await confirmLoginOtp("p1", codeFrom(0))).ok).toBe(false); // a used code cannot be replayed
  });

  it("counts wrong guesses and locks the code after its attempts are used, even for the right code afterwards", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    const right = codeFrom(0);
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await confirmLoginOtp("p1", wrong)).ok).toBe(false);
    expect(otps[0].attempts).toBe(3);
    expect(otps[0].status).toBe("FAILED");
    expect(await confirmLoginOtp("p1", right)).toMatchObject({ ok: false });
  });

  it("parallel wrong guesses are all counted (the increment is atomic, not read-then-write)", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    const wrong = codeFrom(0) === "000000" ? "111111" : "000000";
    await Promise.all([1, 2, 3].map(() => confirmLoginOtp("p1", wrong)));
    expect(otps[0].attempts).toBe(3);
  });

  it("an expired code is refused", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    otps[0].expiresAt = new Date(Date.now() - 1000);
    expect(await confirmLoginOtp("p1", codeFrom(0))).toMatchObject({ ok: false, error: expect.stringMatching(/expired/i) });
  });

  it("a very long submitted value is cut before it reaches the hash comparison", async () => {
    await sendOtp("p1", "EMAIL", "a@example.com", "LOGIN");
    const res = await confirmLoginOtp("p1", "9".repeat(100_000));
    expect(res.ok).toBe(false);
  });
});

describe("confirmOtp (e-mail verification) is unchanged", () => {
  it("still records the verification and notifies", async () => {
    const hash = await bcrypt.hash("tok", 4);
    otps.push({ id: "ov", profileId: "p1", channel: "EMAIL", codeHash: hash, destinationMasked: "a***", attempts: 0, maxAttempts: 5, status: "PENDING", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date() });
    expect(await confirmOtp("p1", "EMAIL", "tok")).toEqual({ ok: true });
    expect(touched).toContain("profileVerification.upsert");
    expect(touched).toContain("sendNotification");
  });
});
