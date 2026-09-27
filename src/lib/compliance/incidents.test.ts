import { describe, it, expect, vi, beforeEach } from "vitest";

let cases: Record<string, unknown>[];
let auditCalls: Record<string, unknown>[];
let seq = 0;

vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));
vi.mock("@/lib/case-code", () => ({ nextCaseNumber: vi.fn(async () => `LPP-CASE-${String(++seq).padStart(6, "0")}`) }));
vi.mock("@/lib/case-sla", () => ({ computeSlaDueDates: vi.fn(async () => ({ firstResponseDueAt: new Date("2026-01-02"), resolutionDueAt: new Date("2026-01-05") })) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    case: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `case${cases.length + 1}`, ...data };
        cases.push(row);
        return row;
      }),
    },
  },
}));

const { createComplianceIncident } = await import("./incidents");

beforeEach(() => {
  cases = [];
  auditCalls = [];
  seq = 0;
});

describe("createComplianceIncident", () => {
  it("files under CaseType.INTERNAL with the given compliance CaseCategory", async () => {
    const result = await createComplianceIncident({
      category: "UNAUTHORIZED_DISCLOSURE" as never,
      subject: "Unauthorized disclosure detected",
      description: "details",
      actorId: "admin1",
    });
    expect(result.caseNumber).toMatch(/^LPP-CASE-/);
    expect(cases[0]).toMatchObject({ type: "INTERNAL", category: "UNAUTHORIZED_DISCLOSURE" });
  });

  it("defaults to HIGH priority when none is given", async () => {
    await createComplianceIncident({ category: "POLICY_CONFLICT" as never, subject: "s", description: "d", actorId: "admin1" });
    expect(cases[0]).toMatchObject({ priority: "HIGH" });
  });

  it("audits COMPLIANCE_INCIDENT_CREATED", async () => {
    await createComplianceIncident({ category: "PRIVACY_REQUEST_FAILURE" as never, subject: "s", description: "d", actorId: "admin1" });
    expect(auditCalls[0]).toMatchObject({ action: "COMPLIANCE_INCIDENT_CREATED" });
  });
});
