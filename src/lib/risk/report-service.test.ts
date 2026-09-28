import { describe, it, expect, vi, beforeEach } from "vitest";
import { isCategoryValidForType } from "@/lib/case-categories";

type Row = Record<string, unknown>;
let reports: Row[];
let cases: Row[];
let profiles: Row[];
let signalCalls: Row[];
let assessCalls: string[];
let notified: Row[];
let adminNotified: Row[];
let riskCaseId: string | null;
let signalCreated = true;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async () => `LPP-REPORT-${String(reports.length + 1).padStart(6, "0")}`) }));
vi.mock("@/lib/case-code", () => ({ nextCaseNumber: vi.fn(async () => "LPP-CASE-000001") }));
vi.mock("@/lib/case-sla", () => ({ computeSlaDueDates: vi.fn(async () => ({ firstResponseDueAt: null, resolutionDueAt: null })) }));
vi.mock("@/lib/notifications/events", () => ({ notifyCaseStatusChanged: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/notification-service", () => ({
  sendNotification: vi.fn(async (n: Row) => { notified.push(n); }),
  notifyAdmins: vi.fn(async (n: Row) => { adminNotified.push(n); }),
}));
vi.mock("@/lib/risk/signal-service", () => ({ createRiskSignal: vi.fn(async (p: Row) => { signalCalls.push(p); return signalCreated ? { created: true, flag: { id: "f1" } } : { created: false, reason: "OPEN_EXISTS" }; }) }));
vi.mock("@/lib/risk/assessment-service", () => ({ assessProfile: vi.fn(async (id: string) => { assessCalls.push(id); return { assessment: null, unchanged: false, caseOpened: !!riskCaseId, riskCaseId }; }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    riskRule: { findMany: vi.fn(async () => []) },
    profile: { findUnique: vi.fn(async ({ where }: { where: { profileCode: string } }) => profiles.find((p) => p.profileCode === where.profileCode) ?? null) },
    case: { create: vi.fn(async ({ data }: { data: Row }) => { const c = { id: `case${cases.length + 1}`, ...data }; cases.push(c); return c; }) },
    userReport: {
      count: vi.fn(async ({ where }: { where: Row }) => reports.filter((r) => r.reporterProfileId === where.reporterProfileId).length),
      findFirst: vi.fn(async ({ where }: { where: Row }) => reports.find((r) => r.reporterProfileId === where.reporterProfileId && r.reportedProfileId === where.reportedProfileId && ["RECEIVED", "UNDER_REVIEW"].includes(r.status as string)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Row }) => (where.reportedProfileId ? reports.filter((r) => r.reportedProfileId === where.reportedProfileId) : reports.filter((r) => r.reporterProfileId === where.reporterProfileId))),
      create: vi.fn(async ({ data }: { data: Row }) => { const r = { id: `r${reports.length + 1}`, status: "RECEIVED", ...data }; reports.push(r); return r; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { const r = reports.find((x) => x.id === where.id) as Row; Object.assign(r, data); return r; }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => reports.find((r) => r.id === where.id) ?? null),
    },
  },
}));

const svc = await import("./report-service");
const valid = { reporterProfileId: "me", reportType: "SUSPICIOUS_PROFILE", description: "This profile asked me to move to another app quickly.", reportedProfileCode: "LPP-000002" };

beforeEach(() => {
  reports = []; cases = []; signalCalls = []; assessCalls = []; notified = []; adminNotified = []; riskCaseId = null; signalCreated = true;
  profiles = [{ id: "them", profileCode: "LPP-000002" }, { id: "me", profileCode: "LPP-000001" }];
});

describe("categories", () => {
  it("every report type maps to a category that is valid for a SAFETY_REPORT case", () => {
    for (const [type, category] of Object.entries(svc.REPORT_CATEGORY)) expect(isCategoryValidForType("SAFETY_REPORT", category), type).toBe(true);
  });
});

describe("submitUserReport", () => {
  it("creates a Case, a UserReport and ONE low-confidence allegation signal; acknowledges the reporter neutrally", async () => {
    const r = await svc.submitUserReport(valid);
    expect(r).toMatchObject({ reportCode: "LPP-REPORT-000001", status: "RECEIVED", duplicate: false });
    expect(cases[0]).toMatchObject({ type: "SAFETY_REPORT", reporterProfileId: "me", reportedProfileId: "them" });
    expect(signalCalls[0]).toMatchObject({ profileId: "them", flagType: "SAFETY_REPORT_SIGNAL", confidence: "LOW", source: "user-report" });
    expect(String(signalCalls[0].description)).toMatch(/allegation/);
    expect(notified).toEqual([{ profileId: "me", type: "SAFETY_REPORT_ACKNOWLEDGED", data: {} }]);
    expect(adminNotified[0]).toMatchObject({ type: "SAFETY_REPORT_RECEIVED" });
  });

  it("the result reveals nothing about the reported profile or any risk data", async () => {
    const r = await svc.submitUserReport(valid);
    expect(Object.keys(r).sort()).toEqual(["duplicate", "reportCode", "status"]);
  });

  it("validates type and length, strips control characters", async () => {
    await expect(svc.submitUserReport({ ...valid, reportType: "MURDER" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.submitUserReport({ ...valid, description: "short" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.submitUserReport({ ...valid, description: "x".repeat(2001) })).rejects.toMatchObject({ status: 400 });
    await svc.submitUserReport({ ...valid, description: "hello\u0000\u0007 there this is long enough" });
    expect(String(reports[0].description)).not.toMatch(/[\u0000-\u0008]/);
  });

  it("cannot report yourself", async () => {
    await expect(svc.submitUserReport({ ...valid, reportedProfileCode: "LPP-000001" })).rejects.toMatchObject({ status: 400 });
  });

  it("per-reporter daily throttle", async () => {
    for (let i = 0; i < svc.MAX_REPORTS_PER_REPORTER_PER_DAY; i++) reports.push({ id: `x${i}`, reporterProfileId: "me", reportedProfileId: `o${i}`, status: "CLOSED" });
    await expect(svc.submitUserReport(valid)).rejects.toMatchObject({ status: 429 });
  });

  it("a repeat report against the same person is folded into the live one (no spam pile-up, no second signal)", async () => {
    await svc.submitUserReport(valid);
    const second = await svc.submitUserReport(valid);
    expect(second).toMatchObject({ duplicate: true, reportCode: "LPP-REPORT-000001" });
    expect(reports).toHaveLength(1);
    expect(signalCalls).toHaveLength(1);
  });

  it("an unknown profile code is stored as a general report — no error that confirms or denies existence", async () => {
    const r = await svc.submitUserReport({ ...valid, reportedProfileCode: "LPP-999999" });
    expect(r.duplicate).toBe(false);
    expect(reports[0].reportedProfileId).toBeNull();
    expect(signalCalls).toHaveLength(0);
  });

  it("only INDEPENDENT reporters raise confidence (3 distinct reporters → a second, MEDIUM-confidence signal)", async () => {
    reports.push({ id: "o1", reporterProfileId: "x1", reportedProfileId: "them", status: "CLOSED" }, { id: "o2", reporterProfileId: "x2", reportedProfileId: "them", status: "CLOSED" });
    await svc.submitUserReport(valid);
    expect(signalCalls.map((s) => s.flagType)).toEqual(["SAFETY_REPORT_SIGNAL", "ABUSIVE_BEHAVIOR_REPORT"]);
    expect(signalCalls[1]).toMatchObject({ confidence: "MEDIUM" });
  });

  it("requests an assessment (human review) and links a resulting risk case; takes NO action against the reported profile", async () => {
    riskCaseId = "rc1";
    await svc.submitUserReport(valid);
    expect(assessCalls).toEqual(["them"]);
    expect(reports[0].riskCaseId).toBe("rc1");
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    expect(readFileSync(join(process.cwd(), "src/lib/risk/report-service.ts"), "utf8")).not.toMatch(/suspendProfile|applyRestriction|applyRiskRestrictions/);
  });
});

describe("listOwnReports", () => {
  it("selects only reporter-safe fields", async () => {
    const { prisma } = await import("@/lib/prisma");
    await svc.listOwnReports("me");
    const call = (prisma.userReport.findMany as unknown as { mock: { calls: Array<[{ where: Row; select: Row }]> } }).mock.calls.at(-1)?.[0] as { where: Row; select: Row };
    expect(call.where).toEqual({ reporterProfileId: "me" });
    expect(Object.keys(call.select).sort()).toEqual(["createdAt", "reportCode", "reportType", "resolutionNote", "status", "updatedAt"]);
  });
});

describe("updateReportStatus", () => {
  const actor = { id: "a1" } as never;
  beforeEach(() => { reports = [{ id: "r1", reportCode: "LPP-REPORT-000001", reporterProfileId: "me", reportedProfileId: "them", status: "RECEIVED" }]; });
  it("enforces the transition table and a resolution note for outcomes", async () => {
    await expect(svc.updateReportStatus("r1", actor, "ACTION_TAKEN", "done")).rejects.toMatchObject({ status: 409 });
    await svc.updateReportStatus("r1", actor, "UNDER_REVIEW");
    await expect(svc.updateReportStatus("r1", actor, "NO_ACTION_NEEDED")).rejects.toMatchObject({ status: 422 });
    const r = await svc.updateReportStatus("r1", actor, "NO_ACTION_NEEDED", "Reviewed; no further action needed.");
    expect(r.status).toBe("NO_ACTION_NEEDED");
    await expect(svc.updateReportStatus("nope", actor, "CLOSED", "x")).rejects.toMatchObject({ status: 404 });
  });
});
