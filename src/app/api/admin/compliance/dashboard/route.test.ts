import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "COMPLIANCE_MANAGER", permissions: [] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jurisdiction: { count: vi.fn(async () => 2) },
    complianceRule: { count: vi.fn(async () => 5) },
    dataTransferAssessment: { count: vi.fn(async () => 1) },
  },
}));
vi.mock("@/lib/compliance/rules", () => ({ listRulesDueForReview: vi.fn(async () => [{ id: "r1" }]) }));
vi.mock("@/lib/compliance/processors", () => ({ listProcessorsDueForReview: vi.fn(async () => []) }));
vi.mock("@/lib/compliance/authority-requests", () => ({ listAuthorityRequestsAwaitingReview: vi.fn(async () => [{ id: "req1" }, { id: "req2" }]) }));
vi.mock("@/lib/compliance/legal-hold", () => ({ listHoldsPendingRelease: vi.fn(async () => []) }));

const { GET } = await import("./route");

describe("GET /api/admin/compliance/dashboard", () => {
  it("aggregates KPIs from every compliance sub-area", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.kpis).toEqual({
      jurisdictionCount: 2,
      activeRuleCount: 5,
      rulesDueForReview: 1,
      processorsDueForReview: 0,
      authorityRequestsAwaitingReview: 2,
      holdsPendingRelease: 0,
      transfersReviewRequired: 1,
    });
  });
});
