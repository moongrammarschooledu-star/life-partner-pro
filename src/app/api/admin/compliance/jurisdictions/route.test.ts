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
    requireAdmin: vi.fn(async (permission?: string) => {
      if (permission === "compliance:jurisdictions:manage" && deniedForManage) throw new (class ApiError extends Error { status = 403; })("Forbidden");
      return { id: "admin1", role: "COMPLIANCE_MANAGER", permissions: [permission] };
    }),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

let deniedForManage = false;
let createCalls: Record<string, unknown>[] = [];
const jurisdictions: Record<string, unknown>[] = [];

vi.mock("@/lib/compliance/jurisdiction", () => ({
  listJurisdictions: vi.fn(async () => jurisdictions),
  createJurisdiction: vi.fn(async (input: Record<string, unknown>) => {
    createCalls.push(input);
    const row = { id: "j1", status: "DRAFT", ...input };
    jurisdictions.push(row);
    return row;
  }),
}));

const { GET, POST } = await import("./route");

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  deniedForManage = false;
  createCalls = [];
  jurisdictions.length = 0;
});

describe("GET /api/admin/compliance/jurisdictions", () => {
  it("lists jurisdictions", async () => {
    jurisdictions.push({ id: "j1", jurisdictionCode: "PK" });
    const res = await GET();
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });
});

describe("POST /api/admin/compliance/jurisdictions", () => {
  it("requires jurisdictionCode, countryCode and name", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(createCalls).toHaveLength(0);
  });

  it("creates a jurisdiction when valid", async () => {
    const res = await POST(req({ jurisdictionCode: "PK", countryCode: "PK", name: "Pakistan" }));
    expect(res.status).toBe(201);
    expect(createCalls).toHaveLength(1);
  });

  it("requires compliance:jurisdictions:manage, not just :view", async () => {
    deniedForManage = true;
    const res = await POST(req({ jurisdictionCode: "PK", countryCode: "PK", name: "Pakistan" }));
    expect(res.status).toBe(403);
    expect(createCalls).toHaveLength(0);
  });
});
