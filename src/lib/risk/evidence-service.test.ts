import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
let evidence: Row[];
let caseRow: Row | null;
let caseEvents: Row[];
let audits: Row[];
let accessLogs: Row[];
let holds: Row[];

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/access-log", () => ({ logPrivacyAccess: vi.fn(async (a: Row) => { accessLogs.push(a); }) }));
vi.mock("@/lib/risk/case-service", () => ({
  ACTIVE_CASE_STATUSES: ["OPEN", "ACKNOWLEDGED", "UNDER_INVESTIGATION", "INFORMATION_REQUESTED", "ESCALATED", "RESTRICTED", "SUSPENDED"],
  getRiskCaseForActor: vi.fn(async (id: string) => { if (!caseRow || caseRow.id !== id) throw Object.assign(new Error("Risk case not found."), { status: 404 }); return caseRow; }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskEvidence: {
      create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `ev${evidence.length + 1}`, ...data }; evidence.push(r); return r; }),
      findMany: vi.fn(async () => evidence),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const e = evidence.find((x) => x.id === where.id); return e ? { ...e, riskCase: caseRow } : null; }),
    },
    riskCaseEvent: { create: vi.fn(async ({ data }: { data: Row }) => { caseEvents.push(data); return data; }) },
    dataHold: { findFirst: vi.fn(async () => holds[0] ?? null) },
  },
}));

const svc = await import("./evidence-service");
const actor = { id: "a1", permissions: ["risk:evidence:manage"] } as never;

beforeEach(() => {
  evidence = []; caseEvents = []; audits = []; accessLogs = []; holds = [];
  caseRow = { id: "c1", riskCode: "LPP-RISK-000001", subjectProfileId: "p1", status: "UNDER_INVESTIGATION" };
});

describe("integrity hash", () => {
  it("canonicalJson is key-order independent", () => {
    expect(svc.canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(svc.canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it("the hash is deterministic and covers source, summary, time and payload", () => {
    const parts = { source: "s", summary: "x", occurredAt: new Date("2026-01-01"), payload: null };
    const h = svc.computeEvidenceHash(parts);
    expect(svc.computeEvidenceHash({ ...parts })).toBe(h);
    for (const change of [{ source: "t" }, { summary: "y" }, { occurredAt: new Date("2026-01-02") }, { payload: "{}" }]) expect(svc.computeEvidenceHash({ ...parts, ...change })).not.toBe(h);
  });
  it("verifyEvidenceRecord detects tampering", async () => {
    const e = await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "audit", summary: "login burst", payload: { count: 12 } });
    expect(svc.verifyEvidenceRecord(e as never)).toBe(true);
    expect(svc.verifyEvidenceRecord({ ...(e as object), summary: "edited later" } as never)).toBe(false);
  });
});

describe("addEvidence", () => {
  it("redacts contact/credential fields from the stored payload", async () => {
    const e = await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "CONTACT_CHANGE", source: "x", summary: "phone changed", payload: { mobileNumber: "+923001234567", email: "a@b.c", fieldsChanged: 2, otp: "1" } });
    expect(JSON.parse(e.payload as string)).toEqual({ fieldsChanged: 2 });
    expect(JSON.stringify(evidence)).not.toContain("923001234567");
  });
  it("adds a timeline event and an audit row", async () => {
    await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "audit", summary: "something" });
    expect(caseEvents[0]).toMatchObject({ eventType: "EVIDENCE_ADDED" });
    expect(audits[0]).toMatchObject({ action: "RISK_EVIDENCE_ADDED", targetProfileId: "p1" });
  });
  it("cannot be added to a closed case, and needs a summary", async () => {
    await expect(svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "a", summary: "x" })).rejects.toMatchObject({ status: 422 });
    caseRow = { ...(caseRow as Row), status: "CLOSED" };
    await expect(svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "a", summary: "long enough" })).rejects.toMatchObject({ status: 409 });
  });
  it("IDOR: evidence on a case the actor cannot see 404s", async () => {
    await expect(svc.addEvidence({ riskCaseId: "someone-elses", actor, evidenceType: "AUDIT_EVENT", source: "a", summary: "long enough" })).rejects.toMatchObject({ status: 404 });
  });
  it("exposes no update/delete API (append-only)", () => {
    expect(Object.keys(svc).filter((k) => /update|delete|remove|edit/i.test(k))).toEqual([]);
  });
});

describe("listEvidence", () => {
  it("is itself a logged, audited sensitive access, and reports integrity per record", async () => {
    await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "audit", summary: "first item" });
    const rows = await svc.listEvidence("c1", actor);
    expect(rows[0].integrityOk).toBe(true);
    expect(accessLogs[0]).toMatchObject({ actorAdminId: "a1", action: "RISK_EVIDENCE_VIEWED", targetProfileId: "p1", purpose: "FRAUD_PREVENTION" });
    expect(audits.at(-1)).toMatchObject({ action: "RISK_EVIDENCE_VIEWED" });
  });
  it("flags a tampered row", async () => {
    await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "audit", summary: "first item" });
    evidence[0].summary = "rewritten";
    expect((await svc.listEvidence("c1", actor))[0].integrityOk).toBe(false);
  });
});

describe("retention blockers", () => {
  it("evidence of an open case cannot be deleted", async () => {
    const e = await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "audit", summary: "first item" });
    expect(await svc.evidenceDeletionBlockers(e.id)).toContain("The risk case is still open.");
  });
  it("evidence under an active legal hold cannot be deleted even after the case closes", async () => {
    const e = await svc.addEvidence({ riskCaseId: "c1", actor, evidenceType: "AUDIT_EVENT", source: "audit", summary: "first item" });
    caseRow = { ...(caseRow as Row), status: "CLOSED" };
    holds = [{ id: "h1" }];
    expect(await svc.evidenceDeletionBlockers(e.id)).toEqual(["An active legal hold covers the subject profile."]);
    holds = [];
    expect(await svc.evidenceDeletionBlockers(e.id)).toEqual([]);
  });
});
