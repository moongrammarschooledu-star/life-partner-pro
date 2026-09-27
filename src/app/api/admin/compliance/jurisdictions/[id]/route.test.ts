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

let jurisdiction: Record<string, unknown> | null;
let updateCalls: Array<{ id: string; patch: Record<string, unknown> }>;

vi.mock("@/lib/compliance/jurisdiction", () => ({
  getJurisdiction: vi.fn(async (id: string) => (jurisdiction && jurisdiction.id === id ? jurisdiction : null)),
  updateJurisdiction: vi.fn(async (id: string, patch: Record<string, unknown>) => {
    updateCalls.push({ id, patch });
    return { ...jurisdiction, ...patch };
  }),
}));

const { GET, PATCH } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  jurisdiction = { id: "j1", jurisdictionCode: "PK", status: "DRAFT" };
  updateCalls = [];
});

describe("GET /api/admin/compliance/jurisdictions/[id]", () => {
  it("404s for an unknown id", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("returns the jurisdiction", async () => {
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "j1" }) });
    expect((await res.json()).jurisdictionCode).toBe("PK");
  });
});

describe("PATCH /api/admin/compliance/jurisdictions/[id]", () => {
  it("404s for an unknown id and never calls update", async () => {
    const res = await PATCH(req({ status: "ACTIVE" }), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects an invalid status value", async () => {
    const res = await PATCH(req({ status: "BOGUS" }), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("updates status when valid", async () => {
    const res = await PATCH(req({ status: "ACTIVE" }), { params: Promise.resolve({ id: "j1" }) });
    expect(res.status).toBe(200);
    expect(updateCalls[0]).toMatchObject({ id: "j1", patch: { status: "ACTIVE" } });
  });
});
