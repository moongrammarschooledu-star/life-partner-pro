import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let incidents: Row[];
let sessionRevocations: Row[];
let audits: Row[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    profileSession: { updateMany: vi.fn(async (a: Row) => { sessionRevocations.push(a); return { count: 2 }; }) },
    securityIncident: {
      create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `i${incidents.length + 1}`, status: "ACTIVE", ...data }; incidents.push(r); return r; }),
      findFirst: vi.fn(async ({ where }: { where: Row }) => incidents.find((i) => i.controlType === where.controlType && i.subjectType === where.subjectType && i.subjectRef === where.subjectRef && i.status === "ACTIVE" && (i.expiresAt as Date) > new Date()) ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => incidents.find((i) => i.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const i = incidents.find((x) => x.id === where.id) as Row; Object.assign(i, data); return i; }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  },
}));

const svc = await import("./technical-controls");
const actor = { id: "a1" } as never;

beforeEach(() => { incidents = []; sessionRevocations = []; audits = []; });

describe("applyTechnicalControl", () => {
  it("is time-boxed: default 60 min, hard cap 24 h, minimum 1 min", async () => {
    const now = Date.now();
    const a = await svc.applyTechnicalControl({ controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: "h", reason: "credential stuffing", actor });
    const b = await svc.applyTechnicalControl({ controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: "h2", reason: "credential stuffing", actor, durationMinutes: 999_999 });
    const c = await svc.applyTechnicalControl({ controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: "h3", reason: "credential stuffing", actor, durationMinutes: -5 });
    expect((a.expiresAt as Date).getTime() - now).toBeGreaterThan(59 * 60_000);
    expect((a.expiresAt as Date).getTime() - now).toBeLessThan(61 * 60_000);
    expect((b.expiresAt as Date).getTime() - now).toBeLessThanOrEqual(24 * 3_600_000 + 1000);
    expect((c.expiresAt as Date).getTime() - now).toBeLessThan(2 * 60_000);
  });

  it("needs a subject and a reason, and cannot target the acting admin", async () => {
    await expect(svc.applyTechnicalControl({ controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: " ", reason: "attack", actor })).rejects.toMatchObject({ status: 422 });
    await expect(svc.applyTechnicalControl({ controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: "x", reason: "no", actor })).rejects.toMatchObject({ status: 422 });
    await expect(svc.applyTechnicalControl({ controlType: "SESSION_REVOCATION", subjectType: "ADMIN", subjectRef: "a1", reason: "self lock-out", actor })).rejects.toMatchObject({ status: 403 });
  });

  it("session revocation revokes profile sessions and audits it as 'not a decision about the person'", async () => {
    await svc.applyTechnicalControl({ controlType: "SESSION_REVOCATION", subjectType: "PROFILE", subjectRef: "p1", reason: "account takeover suspected", actor });
    expect(sessionRevocations[0]).toMatchObject({ where: { profileId: "p1", revokedAt: null } });
    expect(audits[0]).toMatchObject({ action: "RISK_TECHNICAL_CONTROL_APPLIED", targetProfileId: "p1" });
    expect(JSON.stringify(audits[0])).toMatch(/not a decision about the person/);
  });

  it("isControlActive honours expiry and lift", async () => {
    const i = await svc.applyTechnicalControl({ controlType: "SUBJECT_THROTTLE", subjectType: "SUBJECT_KEY", subjectRef: "k", reason: "otp flooding", actor });
    expect(await svc.isControlActive("SUBJECT_THROTTLE", "SUBJECT_KEY", "k")).toBe(true);
    expect(await svc.isControlActive("SUBJECT_THROTTLE", "SUBJECT_KEY", "other")).toBe(false);
    await svc.liftTechnicalControl(i.id, actor);
    expect(await svc.isControlActive("SUBJECT_THROTTLE", "SUBJECT_KEY", "k")).toBe(false);
    await expect(svc.liftTechnicalControl(i.id, actor)).rejects.toMatchObject({ status: 409 });
    incidents.push({ id: "old", controlType: "IP_BLOCK", subjectType: "IP_HASH", subjectRef: "gone", status: "ACTIVE", expiresAt: new Date(Date.now() - 1000) });
    expect(await svc.isControlActive("IP_BLOCK", "IP_HASH", "gone")).toBe(false);
  });

  it("technical controls never touch a profile's restrictions or status (structural)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const text = readFileSync(join(process.cwd(), "src/lib/risk/technical-controls.ts"), "utf8");
    expect(text).not.toMatch(/suspendProfile|applyRestriction|profileRestriction|profile\.update/);
  });
});
