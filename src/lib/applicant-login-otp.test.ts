import { describe, it, expect, vi, beforeEach } from "vitest";

// STEP 33 — applicant sign-in is Profile ID + e-mail address + a one-time code mailed to that address. The first two are identifiers other
// people can know (the Profile ID is shown to the other party of a proposal), so they must never open a session on their own.

const cookiesSet: Array<{ name: string; value: string }> = [];
let flagOn = true;
let restricted = false;
let limiterAllows = true;
const sendOtpCalls: Array<{ profileId: string; destination: string; purpose: string }> = [];
let confirmResult: { ok: true } | { ok: false; error: string } = { ok: true };
const confirmCalls: Array<{ profileId: string; code: string }> = [];
const securityEvents: Array<{ eventType: string; outcome?: string }> = [];

const profileRow = { id: "p1", profileCode: "LPP-000001", status: "ACTIVE", verified: true, profileCompletion: 80, createdAt: new Date("2026-01-01"), softDeleted: false, contact: { email: "Asha@Example.com" } };

vi.mock("next/headers", () => ({ cookies: async () => ({ set: (name: string, value: string) => { cookiesSet.push({ name, value }); }, get: () => undefined }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { profile: { findUnique: async ({ where }: { where: { profileCode: string } }) => (where.profileCode === "LPP-000001" ? { ...profileRow } : null) } },
}));
vi.mock("@/lib/security/rate-limit-policy", () => ({ enforceConfiguredLimit: async () => null }));
vi.mock("@/lib/ops/rate-limit-persistent", () => ({
  rateLimitPersistent: async () => ({ allowed: limiterAllows, count: 1 }),
  tooManyRequests: () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }),
}));
vi.mock("@/lib/ops/feature-flags", () => ({ isFeatureEnabled: async () => flagOn }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: async () => restricted }));
vi.mock("@/lib/applicant-session", () => ({ signProfileToken: (id: string) => `tok:${id}`, signSessionId: (id: string) => `sid:${id}`, APPLICANT_COOKIE: "lpp_session", APPLICANT_SESSION_ID_COOKIE: "lpp_sid" }));
vi.mock("@/lib/profile-session", () => ({ createProfileSession: async () => ({ id: "sess1" }) }));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: async (e: { eventType: string; outcome?: string }) => { securityEvents.push(e); } }));
vi.mock("@/lib/require-applicant", () => ({ requireApplicantProfileId: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ clientKeyFromRequest: () => "1.2.3.4" }));
vi.mock("@/lib/verification/otp-service", () => ({
  sendOtp: async (profileId: string, _channel: string, destination: string, purpose: string) => { sendOtpCalls.push({ profileId, destination, purpose }); return { otpId: "o1", destinationMasked: "A***@Example.com" }; },
  confirmLoginOtp: async (profileId: string, code: string) => { confirmCalls.push({ profileId, code }); return confirmResult; },
}));

const { POST: signIn } = await import("@/app/api/my-status/route");
const { POST: verify } = await import("@/app/api/my-status/verify/route");

const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  cookiesSet.length = 0; sendOtpCalls.length = 0; confirmCalls.length = 0; securityEvents.length = 0;
  flagOn = true; restricted = false; limiterAllows = true; confirmResult = { ok: true };
});

describe("step one: POST /api/my-status", () => {
  it("with the right Profile ID and e-mail it mails a code and signs NOBODY in", async () => {
    const res = await signIn(post("/api/my-status", { profileCode: "lpp-000001", email: "asha@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ otpRequired: true, destinationMasked: expect.any(String) });
    expect(cookiesSet).toEqual([]);
    expect(sendOtpCalls).toEqual([{ profileId: "p1", destination: "Asha@Example.com", purpose: "LOGIN" }]);
  });

  it("never returns the profile status or sets a cookie before the code is proven", async () => {
    const res = await signIn(post("/api/my-status", { profileCode: "LPP-000001", email: "asha@example.com" }));
    const body = await res.json();
    expect(body).not.toHaveProperty("status");
    expect(body).not.toHaveProperty("profileCompletion");
    expect(cookiesSet).toHaveLength(0);
  });

  it("a wrong e-mail address gets the generic 404, no code is mailed, and the failure is recorded", async () => {
    const res = await signIn(post("/api/my-status", { profileCode: "LPP-000001", email: "someone.else@example.com" }));
    expect(res.status).toBe(404);
    expect(sendOtpCalls).toEqual([]);
    expect(securityEvents[0]).toMatchObject({ eventType: "LOGIN_FAILED", outcome: "NO_MATCH" });
  });

  it("an unknown Profile ID looks exactly like a wrong e-mail", async () => {
    const a = await signIn(post("/api/my-status", { profileCode: "LPP-999999", email: "asha@example.com" }));
    const b = await signIn(post("/api/my-status", { profileCode: "LPP-000001", email: "nope@example.com" }));
    expect(a.status).toBe(b.status);
    expect(await a.json()).toEqual(await b.json());
  });

  it("a restricted account is treated as no match (no code is mailed for an account that could not use it)", async () => {
    restricted = true;
    const res = await signIn(post("/api/my-status", { profileCode: "LPP-000001", email: "asha@example.com" }));
    expect(res.status).toBe(404);
    expect(sendOtpCalls).toEqual([]);
  });

  it("mails to one profile are capped, so the endpoint cannot be used to flood a mailbox", async () => {
    limiterAllows = false;
    const res = await signIn(post("/api/my-status", { profileCode: "LPP-000001", email: "asha@example.com" }));
    expect(res.status).toBe(429);
    expect(sendOtpCalls).toEqual([]);
  });

  it("a malformed body is a 400, not a server error", async () => {
    expect((await signIn(post("/api/my-status", "{not json"))).status).toBe(400);
    expect((await signIn(post("/api/my-status", { profileCode: 5, email: {} }))).status).toBe(400);
  });

  it("with the feature flag OFF (e-mail delivery down) the previous sign-in still works, so nobody is locked out", async () => {
    flagOn = false;
    const res = await signIn(post("/api/my-status", { profileCode: "LPP-000001", email: "asha@example.com" }));
    expect(res.status).toBe(200);
    expect(sendOtpCalls).toEqual([]);
    expect(cookiesSet.map((c) => c.name).sort()).toEqual(["lpp_session", "lpp_sid"]);
  });
});

describe("step two: POST /api/my-status/verify", () => {
  const good = { profileCode: "LPP-000001", email: "asha@example.com", code: "123456" };

  it("the right code sets both session cookies and returns only the narrow status", async () => {
    const res = await verify(post("/api/my-status/verify", good));
    expect(res.status).toBe(200);
    expect(cookiesSet.map((c) => c.name).sort()).toEqual(["lpp_session", "lpp_sid"]);
    expect(confirmCalls).toEqual([{ profileId: "p1", code: "123456" }]);
    expect(Object.keys(await res.json()).sort()).toEqual(["createdAt", "profileCode", "profileCompletion", "status", "verified"]);
  });

  it("a wrong code sets no cookie and is recorded as a failed sign-in", async () => {
    confirmResult = { ok: false, error: "Incorrect code. Please try again." };
    const res = await verify(post("/api/my-status/verify", good));
    expect(res.status).toBe(400);
    expect(cookiesSet).toEqual([]);
    expect(securityEvents.at(-1)).toMatchObject({ eventType: "LOGIN_FAILED", outcome: "WRONG_CODE" });
  });

  it("the e-mail address is checked again here: the right code with the wrong address does not sign in", async () => {
    const res = await verify(post("/api/my-status/verify", { ...good, email: "someone.else@example.com" }));
    expect(res.status).toBe(400);
    expect(confirmCalls).toEqual([]);
    expect(cookiesSet).toEqual([]);
  });

  it("a restricted account cannot complete a sign-in", async () => {
    restricted = true;
    expect((await verify(post("/api/my-status/verify", good))).status).toBe(400);
    expect(cookiesSet).toEqual([]);
  });

  it("guesses against one profile are capped however they are spread", async () => {
    limiterAllows = false;
    expect((await verify(post("/api/my-status/verify", good))).status).toBe(429);
    expect(confirmCalls).toEqual([]);
  });

  it("missing, empty, oversized or malformed input is a 400 with the same message", async () => {
    for (const body of ["{bad", { ...good, code: "" }, { ...good, code: "x".repeat(100) }, { ...good, code: 123456 }]) {
      const res = await verify(post("/api/my-status/verify", body));
      expect(res.status).toBe(400);
    }
    expect(cookiesSet).toEqual([]);
  });
});
