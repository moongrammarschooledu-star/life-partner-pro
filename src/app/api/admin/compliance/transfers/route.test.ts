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
    dataTransferAssessment: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        findManyCalls.push(args);
        return [];
      }),
    },
  },
}));

let assessCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/compliance/transfer", () => ({
  assessTransfer: vi.fn(async (input: Record<string, unknown>) => {
    assessCalls.push(input);
    return { id: "xfer1", status: "REVIEW_REQUIRED" };
  }),
}));

const { GET, POST } = await import("./route");

function postReq(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  findManyCalls = [];
  assessCalls = [];
});

describe("GET /api/admin/compliance/transfers", () => {
  it("lists assessments, optionally filtered by status", async () => {
    await GET(new Request("http://x/api/admin/compliance/transfers?status=BLOCKED"));
    expect(findManyCalls[0]).toMatchObject({ where: { status: "BLOCKED" } });
  });
});

describe("POST /api/admin/compliance/transfers", () => {
  it("requires dataClass, dataType and purpose", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect(assessCalls).toHaveLength(0);
  });

  it("assesses the transfer and attributes the admin", async () => {
    const res = await POST(postReq({ dataClass: "HIGHLY_SENSITIVE", dataType: "identity_document", purpose: "IDENTITY_VERIFICATION" }));
    expect(res.status).toBe(201);
    expect(assessCalls[0]).toMatchObject({ assessedById: "admin1", dataClass: "HIGHLY_SENSITIVE" });
  });
});
