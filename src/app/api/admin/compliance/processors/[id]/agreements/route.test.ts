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

let processor: Record<string, unknown> | null;
let createCalls: Array<Record<string, unknown>>;

vi.mock("@/lib/compliance/processors", () => ({
  getProcessor: vi.fn(async (id: string) => (processor && processor.id === id ? processor : null)),
  listAgreementsForProcessor: vi.fn(async () => []),
  createAgreement: vi.fn(async (input: Record<string, unknown>) => {
    createCalls.push(input);
    return { id: "agr1", agreementStatus: "DRAFT", ...input };
  }),
}));

const { GET, POST } = await import("./route");

function postReq(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  processor = { id: "proc1" };
  createCalls = [];
});

describe("GET /api/admin/compliance/processors/[id]/agreements", () => {
  it("404s for an unknown processor", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/compliance/processors/[id]/agreements", () => {
  it("404s for an unknown processor", async () => {
    const res = await POST(postReq({ agreementType: "DPA" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    expect(createCalls).toHaveLength(0);
  });

  it("requires agreementType", async () => {
    const res = await POST(postReq({}), { params: Promise.resolve({ id: "proc1" }) });
    expect(res.status).toBe(400);
    expect(createCalls).toHaveLength(0);
  });

  it("creates an agreement scoped to the path processor id, never a client-supplied one", async () => {
    const res = await POST(postReq({ agreementType: "DPA", processorId: "someone-elses-processor" }), { params: Promise.resolve({ id: "proc1" }) });
    expect(res.status).toBe(201);
    expect(createCalls[0]).toMatchObject({ processorId: "proc1" });
  });
});
