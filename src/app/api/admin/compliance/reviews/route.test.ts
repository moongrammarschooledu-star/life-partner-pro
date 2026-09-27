import { describe, it, expect, vi, beforeEach } from "vitest";

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

let findManyCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    complianceReview: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        findManyCalls.push(args);
        return [];
      }),
    },
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  findManyCalls = [];
});

describe("GET /api/admin/compliance/reviews", () => {
  it("only lists open-status reviews by default", async () => {
    await GET(new Request("http://x/api/admin/compliance/reviews"));
    const where = findManyCalls[0].where as { status: { in: string[] } };
    expect(where.status.in).toEqual(["DRAFT", "PENDING_REVIEW", "LEGAL_REVIEW", "COMPLIANCE_REVIEW", "REVIEW_REQUIRED"]);
    expect(where).not.toHaveProperty("subjectType");
  });

  it("filters by subjectType when given", async () => {
    await GET(new Request("http://x/api/admin/compliance/reviews?subjectType=ORDER"));
    expect(findManyCalls[0].where).toMatchObject({ subjectType: "ORDER" });
  });
});
