import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin e-mail-code password reset: enumeration resistance, single use, expiry, attempt cap, supersession, session
// revocation, 2FA/login separation and the route-level responses — over an in-memory database with the REAL service.

type Row = Record<string, unknown> & { id?: string };
const db = new Map<string, Row[]>();
let idc = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if ("gte" in c && !((actual as Date) >= (c.gte as Date))) return false;
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}
function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => { const r: Row = { id: `${t}-${++idc}`, createdAt: new Date(), attempts: 0, consumedAt: null, ...data }; rows(t).push(r); return { ...r }; },
    findUnique: async ({ where }: { where: Row }) => { const r = rows(t).find((x) => matches(x, t === "appSettings" ? {} : where)); return r ? { ...r } : null; },
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: { createdAt?: "desc" } } = {}) => {
      const list = rows(t).filter((x) => matches(x, where));
      if (orderBy?.createdAt === "desc") list.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return list[0] ? { ...list[0] } : null;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = rows(t).find((x) => matches(x, where));
      if (!r) throw new Error("nf");
      for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in (v as Row) ? (r[k] as number) + ((v as Row).increment as number) : v;
      return { ...r };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hit = rows(t).filter((x) => matches(x, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
    delete: async ({ where }: { where: Row }) => { const i = rows(t).findIndex((x) => matches(x, where)); if (i < 0) throw new Error("nf"); rows(t).splice(i, 1); return {}; },
  };
}

const sent: Array<{ to: string; subject?: string; body: string }> = [];
let failSend = false;
const audits: Row[] = [];
let limitDenied = false;

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/notifications", () => ({
  notificationService: { send: vi.fn(async (p: { to: string; subject?: string; body: string }) => { if (failSend) throw new Error("smtp down"); sent.push(p); }) },
}));
vi.mock("@/lib/ops/rate-limit-persistent", () => ({
  enforcePersistentLimit: vi.fn(async () => (limitDenied ? new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }) : null)),
}));

const svc = await import("./admin-password-reset");
const bcrypt = (await import("bcryptjs")).default;
const { POST: forgotRoute } = await import("@/app/api/admin/auth/forgot-password/route");
const { POST: resetRoute } = await import("@/app/api/admin/auth/reset-password/route");

const codeFromMail = () => /code is (\d{6})/.exec(sent.at(-1)?.body ?? "")?.[1] as string;
const challenges = () => rows("adminOtpChallenge");
const admin = () => rows("adminUser")[0];

beforeEach(async () => {
  db.clear(); sent.length = 0; audits.length = 0; failSend = false; limitDenied = false; idc = 0;
  rows("adminUser").push({ id: "a1", email: "boss@example.com", active: true, passwordHash: await bcrypt.hash("OldPassword!1", 4), mustResetPassword: true });
  rows("adminSession").push({ id: "s1", adminId: "a1", revokedAt: null }, { id: "s2", adminId: "a1", revokedAt: null }, { id: "s3", adminId: "other", revokedAt: null });
});

describe("requesting a code", () => {
  it("e-mails a 6-digit code to the admin and stores only its hash", async () => {
    await svc.requestAdminPasswordReset("Boss@Example.com");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("boss@example.com");
    const code = codeFromMail();
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(challenges())).not.toContain(code);
    expect(challenges()[0]).toMatchObject({ adminId: "a1", purpose: "PASSWORD_RESET", maxAttempts: 5 });
    expect((challenges()[0].expiresAt as Date).valueOf() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
  });

  it("an unknown e-mail, an inactive admin and a malformed address send nothing and create nothing", async () => {
    rows("adminUser").push({ id: "a2", email: "gone@example.com", active: false, passwordHash: "x" });
    for (const e of ["nobody@example.com", "gone@example.com", "not-an-email", "", null, 42]) await svc.requestAdminPasswordReset(e);
    expect(sent).toHaveLength(0);
    expect(challenges()).toHaveLength(0);
  });

  it("a new request supersedes the previous code, and a rapid repeat is ignored (cooldown)", async () => {
    await svc.requestAdminPasswordReset("boss@example.com");
    const first = codeFromMail();
    await svc.requestAdminPasswordReset("boss@example.com"); // inside the cooldown: ignored
    expect(sent).toHaveLength(1);
    challenges()[0].createdAt = new Date(Date.now() - 5 * 60_000); // pretend it was 5 minutes ago
    await svc.requestAdminPasswordReset("boss@example.com");
    expect(sent).toHaveLength(2);
    const second = codeFromMail();
    const old = await svc.completeAdminPasswordReset({ email: "boss@example.com", code: first, newPassword: "BrandNewPass#9" });
    if (first !== second) expect(old).toEqual({ ok: false, reason: "invalid_code" });
    expect((await svc.completeAdminPasswordReset({ email: "boss@example.com", code: second, newPassword: "BrandNewPass#9" })).ok).toBe(true);
  });

  it("a delivery failure leaves no usable code behind and does not throw", async () => {
    failSend = true;
    await expect(svc.requestAdminPasswordReset("boss@example.com")).resolves.toBeUndefined();
    expect(challenges()).toHaveLength(0);
  });

  it("audits the request with no code in it", async () => {
    await svc.requestAdminPasswordReset("boss@example.com", { ipAddress: "203.0.113.5" });
    expect(audits[0]).toMatchObject({ action: "ADMIN_USER_PASSWORD_RESET", adminId: "a1" });
    expect(JSON.stringify(audits)).not.toContain(codeFromMail());
  });
});

describe("completing a reset", () => {
  async function issue() {
    await svc.requestAdminPasswordReset("boss@example.com");
    return codeFromMail();
  }
  const finish = (code: string, newPassword = "BrandNewPass#9", email = "boss@example.com") => svc.completeAdminPasswordReset({ email, code, newPassword });

  it("sets the new password, clears the forced-reset flag, revokes every session of that admin only, and tells the owner", async () => {
    const code = await issue();
    expect((await finish(code)).ok).toBe(true);
    expect(await bcrypt.compare("BrandNewPass#9", admin().passwordHash as string)).toBe(true);
    expect(await bcrypt.compare("OldPassword!1", admin().passwordHash as string)).toBe(false);
    expect(admin().mustResetPassword).toBe(false);
    expect(rows("adminSession").filter((s) => s.revokedAt).map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(rows("adminSession").find((s) => s.id === "s3")?.revokedAt).toBeNull();
    expect(sent.at(-1)?.subject).toMatch(/password was changed/i);
    expect(audits.at(-1)).toMatchObject({ action: "ADMIN_USER_PASSWORD_RESET", meta: { stage: "completed", sessionsRevoked: 2 } });
  });

  it("a code works exactly once", async () => {
    const code = await issue();
    expect((await finish(code)).ok).toBe(true);
    expect(await finish(code, "AnotherPass#77")).toEqual({ ok: false, reason: "invalid_code" });
    expect(await bcrypt.compare("BrandNewPass#9", admin().passwordHash as string)).toBe(true);
  });

  it("two simultaneous correct submissions cannot both succeed", async () => {
    const code = await issue();
    const [a, b] = await Promise.all([finish(code, "FirstPass#12345"), finish(code, "SecondPass#12345")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("a wrong code fails generically, counts an attempt, and locks the code after five", async () => {
    const code = await issue();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await finish(wrong)).toEqual({ ok: false, reason: "invalid_code" });
    expect(challenges()[0].attempts).toBe(5);
    expect(await finish(code)).toEqual({ ok: false, reason: "invalid_code" }); // even the right code is now refused
    expect(await bcrypt.compare("OldPassword!1", admin().passwordHash as string)).toBe(true);
  });

  it("an expired code is refused", async () => {
    const code = await issue();
    challenges()[0].expiresAt = new Date(Date.now() - 1000);
    expect(await finish(code)).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("every failure case returns the same result: unknown e-mail, inactive admin, no code issued, malformed code", async () => {
    rows("adminUser").push({ id: "a2", email: "gone@example.com", active: false, passwordHash: "x" });
    const invalid = { ok: false, reason: "invalid_code" };
    expect(await finish("123456", "BrandNewPass#9", "nobody@example.com")).toEqual(invalid);
    expect(await finish("123456", "BrandNewPass#9", "gone@example.com")).toEqual(invalid);
    expect(await finish("123456")).toEqual(invalid); // no code issued yet
    await issue();
    expect(await finish("12345")).toEqual(invalid);
    expect(await finish("abcdef")).toEqual(invalid);
  });

  it("a weak or oversized new password is rejected before the code is touched", async () => {
    const code = await issue();
    const weak = await finish(code, "short");
    expect(weak).toMatchObject({ ok: false, reason: "weak_password" });
    expect(await finish(code, "x".repeat(200))).toMatchObject({ ok: false, reason: "weak_password" });
    expect(challenges()[0]).toMatchObject({ attempts: 0, consumedAt: null });
    expect((await finish(code)).ok).toBe(true); // the same code still works with a proper password
  });

  it("honours a stricter minimum from settings", async () => {
    rows("appSettings").push({ id: "1", passwordMinLength: 12 });
    const code = await issue();
    expect(await finish(code, "Only10char")).toMatchObject({ ok: false, reason: "weak_password" });
    expect((await finish(code, "TwelveCharsOK1")).ok).toBe(true);
  });

  it("a login 2FA code cannot be used to reset a password", async () => {
    rows("adminOtpChallenge").push({ id: "c-login", adminId: "a1", purpose: "LOGIN_2FA", codeHash: await bcrypt.hash("424242", 4), attempts: 0, maxAttempts: 5, expiresAt: new Date(Date.now() + 600_000), consumedAt: null, createdAt: new Date() });
    expect(await finish("424242")).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("a reset code never appears in the response of the completion step", async () => {
    const code = await issue();
    expect(JSON.stringify(await finish(code))).not.toContain(code);
  });
});

describe("routes", () => {
  const post = (handler: (r: Request) => Promise<Response>, body: unknown) => handler(new Request("https://x.test/api", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

  it("forgot-password answers identically for a real, an unknown and a malformed e-mail", async () => {
    const bodies: string[] = [];
    for (const email of ["boss@example.com", "nobody@example.com", "garbage"]) {
      const res = await post(forgotRoute, { email });
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(sent).toHaveLength(1); // only the real admin got an e-mail
    expect(bodies[0]).toContain("If an admin account exists"); // conditional wording, never a yes/no
    expect(bodies[0]).not.toMatch(/no account|not found|unknown/i);
  });

  it("forgot-password still answers the same when delivery fails", async () => {
    failSend = true;
    const res = await post(forgotRoute, { email: "boss@example.com" });
    expect(res.status).toBe(200);
  });

  it("both routes are rate limited and reject bad bodies", async () => {
    limitDenied = true;
    expect((await post(forgotRoute, { email: "boss@example.com" })).status).toBe(429);
    expect((await post(resetRoute, { email: "boss@example.com", code: "123456", newPassword: "BrandNewPass#9" })).status).toBe(429);
    limitDenied = false;
    expect((await post(forgotRoute, "{nope")).status).toBe(400);
    expect((await post(resetRoute, "{nope")).status).toBe(400);
  });

  it("reset-password returns one generic message for every wrong-code case and a specific one only for a weak password", async () => {
    await svc.requestAdminPasswordReset("boss@example.com");
    const wrong = await post(resetRoute, { email: "boss@example.com", code: "000000", newPassword: "BrandNewPass#9" });
    const unknown = await post(resetRoute, { email: "nobody@example.com", code: "000000", newPassword: "BrandNewPass#9" });
    expect(wrong.status).toBe(400);
    expect(await wrong.text()).toBe(await unknown.text());
    const weak = await post(resetRoute, { email: "boss@example.com", code: "000000", newPassword: "x" });
    expect((await weak.json()).error).toMatch(/at least 8/);
  });

  it("completes end to end through the routes", async () => {
    await post(forgotRoute, { email: "boss@example.com" });
    const res = await post(resetRoute, { email: "boss@example.com", code: codeFromMail(), newPassword: "BrandNewPass#9" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await bcrypt.compare("BrandNewPass#9", admin().passwordHash as string)).toBe(true);
  });
});
