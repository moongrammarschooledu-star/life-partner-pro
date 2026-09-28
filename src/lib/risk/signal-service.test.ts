import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let flags: Row[];
let relationships: Row[];
let tasks: Row[];
let audits: Row[];
let notified: unknown[][];
let racing = false;
let factorRows: Row[];
let idc = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/notifications/events", () => ({ notifySecurityFlagRaised: vi.fn(async (...a: unknown[]) => { notified.push(a); }) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { tasks.push(t); return { id: "t" }; }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-SIGNAL-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskFactor: { findMany: vi.fn(async () => factorRows) },
    accountRelationship: { findMany: vi.fn(async () => relationships) },
    securityFlag: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => flags.find((f) => f.profileId === where.profileId && f.flagType === where.flagType && (f.relatedProfileId ?? null) === where.relatedProfileId && (where.status as { in: string[] }).in.includes(f.status as string)) ?? null),
      findUnique: vi.fn(async ({ where }: { where: Row }) => (where.dedupKey ? flags.find((f) => f.dedupKey === where.dedupKey) ?? null : flags.find((f) => f.id === where.id) ?? null)),
      create: vi.fn(async ({ data }: { data: Row }) => {
        if (racing) throw Object.assign(new Error("unique"), { code: "P2002" });
        const row = { id: `f${flags.length + 1}`, status: "OPEN", ...data };
        flags.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const f = flags.find((x) => x.id === where.id) as Row; Object.assign(f, data); return f; }),
      findMany: vi.fn(async () => flags),
    },
  },
}));

const svc = await import("./signal-service");
const config = await import("./config");
const base = { profileId: "p1", flagType: "CONTACT_REUSE_SIGNAL" as const, ruleKey: "contact_reuse", description: "d" };

beforeEach(() => {
  flags = []; relationships = []; tasks = []; audits = []; notified = []; racing = false; factorRows = []; idc = 0;
  config.clearRiskConfigCache();
});

describe("createRiskSignal", () => {
  it("creates one signal with code, category, confidence, rule version, dedup key; audits, notifies and queues a review task", async () => {
    const r = await svc.createRiskSignal(base);
    expect(r.created).toBe(true);
    expect(flags[0]).toMatchObject({ signalCode: "LPP-SIGNAL-000001", category: "CONTACT", confidence: "HIGH", source: "rule-engine", reviewRequired: true, ruleVersion: 0 });
    expect(flags[0].dedupKey).toMatch(/^contact_reuse:p1:-:\d{4}-\d{2}-\d{2}$/);
    expect(audits[0]).toMatchObject({ action: "RISK_SIGNAL_DETECTED" });
    expect(notified).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ taskType: "RISK_SIGNAL_REVIEW", dedupKey: "RISK_SIGNAL_REVIEW:f1" });
  });

  it("an ongoing condition keeps ONE open signal (no pile-up)", async () => {
    await svc.createRiskSignal(base);
    const again = await svc.createRiskSignal(base);
    expect(again).toEqual({ created: false, reason: "OPEN_EXISTS" });
    expect(flags).toHaveLength(1);
  });

  it("the same dedup window key is never created twice, even after the first signal is closed", async () => {
    await svc.createRiskSignal(base);
    flags[0].status = "RESOLVED";
    const again = await svc.createRiskSignal(base);
    expect(again).toEqual({ created: false, reason: "DUPLICATE_KEY" });
  });

  it("CONCURRENCY: losing a unique-key race returns DUPLICATE_KEY instead of throwing or double-creating", async () => {
    racing = true;
    await expect(svc.createRiskSignal(base)).resolves.toEqual({ created: false, reason: "DUPLICATE_KEY" });
    expect(audits).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it("a disabled factor creates nothing", async () => {
    factorRows = [{ factorKey: "CONTACT_REUSE_SIGNAL", version: 2, name: "x", category: "CONTACT", weight: 10, severity: "LOW", enabled: false, immediateControl: false, jurisdictionScope: "GLOBAL" }];
    expect(await svc.createRiskSignal(base)).toEqual({ created: false, reason: "FACTOR_DISABLED" });
  });

  it("FALSE POSITIVE: a pair explained by an authorized family account is suppressed", async () => {
    relationships = [{ profileId: "p1", relatedProfileId: "p2" }];
    const r = await svc.createRiskSignal({ ...base, relatedProfileId: "p2" });
    expect(r).toEqual({ created: false, reason: "RELATIONSHIP_EXPLAINED" });
    expect(flags).toHaveLength(0);
  });

  it("suppression never applies to signal types a relationship cannot explain", async () => {
    relationships = [{ profileId: "p1", relatedProfileId: "p2" }];
    const r = await svc.createRiskSignal({ ...base, flagType: "CONTACT_BYPASS_ATTEMPT", ruleKey: "contact_bypass", relatedProfileId: "p2" });
    expect(r.created).toBe(true);
  });

  it("flags duplicates for the duplicate notification path when asked", async () => {
    await svc.createRiskSignal({ ...base, flagType: "DUPLICATE_PROFILE_SUSPECTED", ruleKey: "duplicate_detection", relatedProfileId: "p2", notifyAsDuplicate: true });
    expect(notified[0]).toEqual(["p1", true, "f1"]);
  });
});

describe("resolveRiskSignal (human-only decisions)", () => {
  beforeEach(() => { flags = [{ id: "f1", profileId: "p1", status: "OPEN", resolution: null, falsePositiveReason: null, resolvedById: null, resolvedAt: null }]; });

  it("requires a resolution note for terminal statuses", async () => {
    await expect(svc.resolveRiskSignal({ flagId: "f1", status: "RESOLVED", adminId: "a1" })).rejects.toMatchObject({ status: 422 });
  });
  it("FALSE_POSITIVE requires a structured reason", async () => {
    await expect(svc.resolveRiskSignal({ flagId: "f1", status: "FALSE_POSITIVE", adminId: "a1", resolution: "shared phone" })).rejects.toMatchObject({ status: 422 });
    const r = await svc.resolveRiskSignal({ flagId: "f1", status: "FALSE_POSITIVE", adminId: "a1", resolution: "shared phone", falsePositiveReason: "SHARED_FAMILY_PHONE" });
    expect(r).toMatchObject({ status: "FALSE_POSITIVE", falsePositiveReason: "SHARED_FAMILY_PHONE", resolvedById: "a1" });
    expect(audits.at(-1)).toMatchObject({ action: "RISK_SIGNAL_RESOLVED", adminId: "a1" });
  });
  it("an archived signal is immutable and unknown ids 404", async () => {
    flags[0].status = "ARCHIVED";
    await expect(svc.resolveRiskSignal({ flagId: "f1", status: "OPEN" as never, adminId: "a1" })).rejects.toBeTruthy();
    await expect(svc.resolveRiskSignal({ flagId: "f1", status: "ACKNOWLEDGED", adminId: "a1" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.resolveRiskSignal({ flagId: "nope", status: "ACKNOWLEDGED", adminId: "a1" })).rejects.toMatchObject({ status: 404 });
  });
  it("a non-terminal review action does not stamp a resolver", async () => {
    const r = await svc.resolveRiskSignal({ flagId: "f1", status: "ACKNOWLEDGED", adminId: "a1" });
    expect(r.resolvedById).toBeNull();
    expect(audits.at(-1)).toMatchObject({ action: "RISK_SIGNAL_REVIEWED" });
  });
});
