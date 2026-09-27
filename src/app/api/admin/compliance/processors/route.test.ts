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

vi.mock("@/lib/compliance/processors", () => ({
  listProcessors: vi.fn(async (filter: Record<string, unknown>) => {
    listCalls.push(filter);
    return [];
  }),
  createProcessor: vi.fn(async (input: Record<string, unknown>) => {
    createCalls.push(input);
    return { id: "proc1", complianceStatus: "REVIEW_REQUIRED", ...input };
  }),
}));

const { GET, POST } = await import("./route");

function postReq(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  listCalls = [];
  createCalls = [];
});

describe("GET /api/admin/compliance/processors", () => {
  it("passes query filters through", async () => {
    await GET(new Request("http://x/api/admin/compliance/processors?serviceType=EMAIL&complianceStatus=COMPLIANT"));
    expect(listCalls[0]).toEqual({ serviceType: "EMAIL", complianceStatus: "COMPLIANT" });
  });
});

describe("POST /api/admin/compliance/processors", () => {
  it("requires name, serviceType and country", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(createCalls).toHaveLength(0);
  });

  it("creates a processor when valid", async () => {
    const res = await POST(postReq({ name: "Acme KYC", serviceType: "IDENTITY_VERIFICATION", country: "US" }));
    expect(res.status).toBe(201);
    expect(createCalls).toHaveLength(1);
  });
});
