import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let events: Row[];
let networkEnabled = false;
let deviceEnabled = false;
let failCreate: unknown = null;
let evaluated: Row[];
let evalDelayMs = 0;
let evalThrows = false;

vi.mock("@/lib/risk/config", () => ({
  getEffectiveRule: vi.fn(async (key: string) => ({ ruleKey: key, version: 0, config: { enabled: key === "unusual_network" ? networkEnabled : key === "shared_device" ? deviceEnabled : false } })),
}));
vi.mock("@/lib/risk/rule-engine", () => ({
  RiskRuleEngine: {
    evaluateSecurityEvent: vi.fn(async (e: Row) => {
      if (evalThrows) throw new Error("boom");
      if (evalDelayMs) await new Promise((r) => setTimeout(r, evalDelayMs));
      evaluated.push(e);
    }),
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityEvent: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (failCreate) throw failCreate;
        const key = data.idempotencyKey as string | null;
        if (key && events.some((e) => e.idempotencyKey === key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: `e${events.length + 1}`, ...data };
        events.push(row);
        return row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: Row }) => ({ count: where ? 3 : 0 })),
    },
    riskCase: { findMany: vi.fn(async () => [{ subjectProfileId: "open-case-profile", subjectAdminId: null }]) },
    dataHold: { findMany: vi.fn(async () => holds) },
  },
}));

let holds: Row[] = [];
const bus = await import("./event-bus");

beforeEach(() => {
  events = [];
  evaluated = [];
  networkEnabled = false;
  deviceEnabled = false;
  failCreate = null;
  evalDelayMs = 0;
  evalThrows = false;
  holds = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("hashing / minimisation", () => {
  it("hashIdentifier is stable, case-insensitive and never contains the raw value", () => {
    const a = bus.hashIdentifier("+923001234567");
    expect(bus.hashIdentifier(" +923001234567 ")).toBe(a);
    expect(a).not.toContain("923001234567");
    expect(a).toHaveLength(32);
    expect(bus.hashIdentifier("A@B.com")).toBe(bus.hashIdentifier("a@b.com"));
  });

  it("sanitizeMeta drops contact/credential/sensitive keys, non-scalars and oversize payloads", () => {
    const json = bus.sanitizeMeta({ phone: "+92300", email: "a@b.c", otpCode: "123456", password: "x", fullName: "N", religion: "r", reason: "denied", count: 3, ok: true, nested: { a: 1 } });
    expect(JSON.parse(json as string)).toEqual({ reason: "denied", count: 3, ok: true });
    expect(bus.sanitizeMeta({ phone: "x" })).toBeNull();
    expect(bus.sanitizeMeta(undefined)).toBeNull();
    const big = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "x".repeat(100)]));
    expect(JSON.parse(bus.sanitizeMeta(big) as string)).toEqual({ truncated: true });
  });

  it("stores IP only for auth events by default, and never a raw IP or user agent", async () => {
    await bus.publishSecurityEvent({ eventType: "LOGIN_FAILED", profileId: "p1", ip: "1.2.3.4", userAgent: "Mozilla", evaluate: false });
    await bus.publishSecurityEvent({ eventType: "PROFILE_UPDATED", profileId: "p1", ip: "1.2.3.4", userAgent: "Mozilla", evaluate: false });
    expect(events[0].ipHash).toBeTruthy();
    expect(events[0].ipHash).not.toBe("1.2.3.4");
    expect(events[0].userAgentHash).toBeNull(); // device signals OFF by default
    expect(events[1].ipHash).toBeNull(); // network signals OFF by default
    expect(JSON.stringify(events)).not.toContain("1.2.3.4");
    expect(JSON.stringify(events)).not.toContain("Mozilla");
  });

  it("stores network/device hashes only once those rules are enabled", async () => {
    networkEnabled = true;
    deviceEnabled = true;
    await bus.publishSecurityEvent({ eventType: "PROFILE_UPDATED", profileId: "p1", ip: "1.2.3.4", userAgent: "Mozilla", evaluate: false });
    expect(events[0].ipHash).toBeTruthy();
    expect(events[0].userAgentHash).toBeTruthy();
  });

  it("pre-auth subjects (phone/email) are stored as a salted hash only", async () => {
    await bus.publishSecurityEvent({ eventType: "OTP_FAILED", subject: "+923001234567", evaluate: false });
    expect(events[0].subjectKey).toBe(bus.hashIdentifier("+923001234567"));
    expect(JSON.stringify(events)).not.toContain("923001234567");
  });
});

describe("normalisation / idempotency / fail-open", () => {
  it("rejects unknown event types and events with no subject", async () => {
    expect(await bus.publishSecurityEvent({ eventType: "MADE_UP" as never, profileId: "p1" })).toMatchObject({ recorded: false, reason: "INVALID" });
    expect(await bus.publishSecurityEvent({ eventType: "LOGIN_FAILED" })).toMatchObject({ recorded: false, reason: "INVALID" });
    expect(events).toHaveLength(0);
  });

  it("a replayed idempotencyKey is recorded once and never re-evaluated", async () => {
    const first = await bus.publishSecurityEvent({ eventType: "PAYMENT_FAILED", profileId: "p1", idempotencyKey: "wh-1" });
    const replay = await bus.publishSecurityEvent({ eventType: "PAYMENT_FAILED", profileId: "p1", idempotencyKey: "wh-1" });
    expect(first.recorded).toBe(true);
    expect(replay).toMatchObject({ recorded: false, reason: "DUPLICATE" });
    expect(events).toHaveLength(1);
    expect(evaluated).toHaveLength(1);
  });

  it("FAILS OPEN: a database error never throws to the caller", async () => {
    failCreate = new Error("connection refused");
    await expect(bus.publishSecurityEvent({ eventType: "LOGIN_FAILED", profileId: "p1" })).resolves.toMatchObject({ recorded: false, reason: "ERROR" });
  });

  it("FAILS OPEN: a rule-engine error never throws and the event is still recorded", async () => {
    evalThrows = true;
    const r = await bus.publishSecurityEvent({ eventType: "LOGIN_FAILED", profileId: "p1" });
    expect(r.recorded).toBe(true);
  });

  it("real-time evaluation is time-bounded", async () => {
    evalDelayMs = 4000;
    const started = Date.now();
    const r = await bus.publishSecurityEvent({ eventType: "LOGIN_FAILED", profileId: "p1" });
    expect(r.recorded).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("only real-time types trigger evaluation; others are just recorded for the batch", async () => {
    await bus.publishSecurityEvent({ eventType: "ACCOUNT_CREATED", profileId: "p1" });
    await bus.publishSecurityEvent({ eventType: "LOGIN_FAILED", profileId: "p1" });
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0].eventType).toBe("LOGIN_FAILED");
  });
});

describe("sweepSecurityEvents (retention)", () => {
  it("deletes old events but excludes profiles with an open case", async () => {
    const { prisma } = await import("@/lib/prisma");
    const result = await bus.sweepSecurityEvents(90);
    expect(result.reviewRequired).toBe(false);
    const call = (prisma.securityEvent.deleteMany as unknown as { mock: { calls: Array<[{ where: Row }]> } }).mock.calls.at(-1)?.[0].where as Row;
    expect(JSON.stringify(call)).toContain("open-case-profile");
    expect(call.createdAt).toBeTruthy();
  });

  it("excludes profiles under an active legal hold", async () => {
    holds = [{ profileId: "held-profile", recordType: null }];
    const { prisma } = await import("@/lib/prisma");
    await bus.sweepSecurityEvents(90);
    const call = (prisma.securityEvent.deleteMany as unknown as { mock: { calls: Array<[{ where: Row }]> } }).mock.calls.at(-1)?.[0].where as Row;
    expect(JSON.stringify(call)).toContain("held-profile");
  });

  it("returns REVIEW_REQUIRED and deletes nothing when a global hold makes scope unknowable", async () => {
    holds = [{ profileId: null, recordType: null }];
    const { prisma } = await import("@/lib/prisma");
    (prisma.securityEvent.deleteMany as unknown as { mockClear: () => void }).mockClear();
    const result = await bus.sweepSecurityEvents(90);
    expect(result).toMatchObject({ deleted: 0, reviewRequired: true });
    expect(prisma.securityEvent.deleteMany).not.toHaveBeenCalled();
  });
});
