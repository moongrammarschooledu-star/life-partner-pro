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
    requireAdmin: vi.fn(async () => ({ id: "admin1", role: "VERIFICATION_MANAGER", permissions: ["duplicates:review"] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

const auditCalls: Record<string, unknown>[] = [];
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (call: Record<string, unknown>) => { auditCalls.push(call); }) }));

interface FakeCandidate { id: string; profileId: string; status: string; securityFlagId: string | null; reviewerId: string | null; }
interface FakeFlag { id: string; status: string; assignedToId: string | null; }

let candidates: Map<string, FakeCandidate>;
let flags: Map<string, FakeFlag>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(txProxy)),
    duplicateCandidate: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => candidates.get(where.id) ?? null),
    },
  },
}));

const txProxy = {
  duplicateCandidate: {
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeCandidate> }) => {
      const c = candidates.get(where.id)!;
      Object.assign(c, data);
      return c;
    },
  },
  securityFlag: {
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeFlag> }) => {
      const f = flags.get(where.id)!;
      Object.assign(f, data);
      return f;
    },
  },
};

const { POST } = await import("./route");

beforeEach(() => {
  candidates = new Map([["c1", { id: "c1", profileId: "p1", status: "POTENTIAL_DUPLICATE", securityFlagId: "f1", reviewerId: null }]]);
  flags = new Map([["f1", { id: "f1", status: "OPEN", assignedToId: null }]]);
  auditCalls.length = 0;
});

describe("POST /api/admin/duplicates/[id]/review", () => {
  it("moves a POTENTIAL_DUPLICATE to DUPLICATE_REVIEW_REQUIRED and claims the linked flag", async () => {
    const res = await POST(new Request("http://x"), { params: Promise.resolve({ id: "c1" }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.status).toBe("DUPLICATE_REVIEW_REQUIRED");
    expect(candidates.get("c1")!.reviewerId).toBe("admin1");
    expect(flags.get("f1")!.status).toBe("INVESTIGATING");
    expect(auditCalls[0]).toMatchObject({ action: "DUPLICATE_CANDIDATE_REVIEWED", adminId: "admin1", targetProfileId: "p1" });
  });

  it("404s for a nonexistent candidate", async () => {
    const res = await POST(new Request("http://x"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("409s when the candidate is no longer awaiting initial review", async () => {
    candidates.set("c1", { id: "c1", profileId: "p1", status: "CONFIRMED_DUPLICATE", securityFlagId: "f1", reviewerId: "admin2" });
    const res = await POST(new Request("http://x"), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(409);
  });
});
