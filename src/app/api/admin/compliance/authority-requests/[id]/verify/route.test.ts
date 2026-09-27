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
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "SUPER_ADMIN", permissions: [] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

let request: Record<string, unknown> | null;
let verifyCalls: Array<{ id: string; verified: boolean; note: string }>;

vi.mock("@/lib/compliance/authority-requests", () => ({
  getAuthorityRequest: vi.fn(async (id: string) => (request && request.id === id ? request : null)),
  recordVerification: vi.fn(async (id: string, verified: boolean, _actor: unknown, note: string) => {
    verifyCalls.push({ id, verified, note });
    return { ...request, verificationStatus: verified ? "VERIFIED" : "REJECTED" };
  }),
}));

const { POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  request = { id: "req1" };
  verifyCalls = [];
});

describe("POST /api/admin/compliance/authority-requests/[id]/verify", () => {
  it("404s for an unknown id", async () => {
    const res = await POST(req({ verified: true, note: "x" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("requires a boolean verified field", async () => {
    const res = await POST(req({ note: "x" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(400);
    expect(verifyCalls).toHaveLength(0);
  });

  it("requires a note", async () => {
    const res = await POST(req({ verified: true }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(400);
    expect(verifyCalls).toHaveLength(0);
  });

  it("records a false verification decision too, not just true", async () => {
    const res = await POST(req({ verified: false, note: "could not confirm authenticity" }), { params: Promise.resolve({ id: "req1" }) });
    expect(res.status).toBe(200);
    expect(verifyCalls[0]).toMatchObject({ id: "req1", verified: false });
  });
});
