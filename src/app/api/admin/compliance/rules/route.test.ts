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

let listCalls: Record<string, unknown>[] = [];
let createCalls: Record<string, unknown>[] = [];
const rules: Record<string, unknown>[] = [];

vi.mock("@/lib/compliance/rules", () => ({
  listRules: vi.fn(async (filter: Record<string, unknown>) => {
    listCalls.push(filter);
    return rules;
  }),
  createRule: vi.fn(async (input: Record<string, unknown>) => {
    createCalls.push(input);
    return { id: "r1", status: "DRAFT", ...input };
  }),
}));

const { GET, POST } = await import("./route");

function reqWithQuery(query: string) {
  return new Request(`http://x/api/admin/compliance/rules${query}`);
}
function postReq(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  listCalls = [];
  createCalls = [];
  rules.length = 0;
});

describe("GET /api/admin/compliance/rules", () => {
  it("passes query filters through", async () => {
    await GET(reqWithQuery("?jurisdictionId=j1&status=ACTIVE&requirementType=AGE_MINIMUM"));
    expect(listCalls[0]).toEqual({ jurisdictionId: "j1", status: "ACTIVE", requirementType: "AGE_MINIMUM" });
  });
});

const validBody = {
  jurisdictionId: "j1",
  subject: "verification.document.CNIC",
  requirementType: "AGE_MINIMUM",
  description: "test",
  sourceType: "LAW",
  effectiveFrom: "2026-01-01",
  configuration: { minAge: 18 },
};

describe("POST /api/admin/compliance/rules", () => {
  it("requires the mandatory fields", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(createCalls).toHaveLength(0);
  });

  it("creates a rule when all required fields are present", async () => {
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    expect(createCalls).toHaveLength(1);
  });
});
