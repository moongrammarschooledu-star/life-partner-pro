import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/route-guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "VERIFICATION_MANAGER", permissions: ["risk:view"] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

interface FakeFlag { id: string; flagType: string; status: string; severity: string; }
let flags: FakeFlag[];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    securityFlag: {
      findMany: vi.fn(async ({ where }: { where: { flagType: { in: string[] }; status?: string } }) =>
        flags.filter((f) => where.flagType.in.includes(f.flagType) && (!where.status || f.status === where.status))
      ),
    },
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  flags = [
    { id: "f1", flagType: "RAPID_REGISTRATION_SIGNAL", status: "OPEN", severity: "MEDIUM" },
    { id: "f2", flagType: "DUPLICATE_PROFILE_SUSPECTED", status: "OPEN", severity: "HIGH" }, // must never appear here
  ];
});

describe("GET /api/admin/risk/signals", () => {
  it("excludes DUPLICATE_PROFILE_SUSPECTED — that flag type belongs to the Duplicate Detection workspace only", async () => {
    const res = await GET(new Request("http://x"));
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].id).toBe("f1");
  });

  it("filters by status when provided", async () => {
    flags.push({ id: "f3", flagType: "CONTACT_REUSE_SIGNAL", status: "RESOLVED", severity: "LOW" });
    const res = await GET(new Request("http://x?status=OPEN"));
    const json = await res.json();
    expect(json.items.map((i: FakeFlag) => i.id)).toEqual(["f1"]);
  });
});
