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
    requireAdmin: vi.fn(async () => ({ id: "manager-1", role: "MATCHMAKING_MANAGER", permissions: ["tasks:bulk-actions"] })),
    handleApiError: (error: unknown) => {
      const status = error && typeof error === "object" && "status" in error ? (error as { status: number }).status : 500;
      return NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status });
    },
  };
});

vi.mock("@/lib/ops/admin-route", () => ({ requireReason: (reason: unknown) => { if (typeof reason !== "string" || reason.trim().length < 5) throw new Error("reason required"); return reason.trim(); } }));

const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
vi.mock("@/lib/audit", () => ({ writeAudit: async (p: { action: string; meta?: Record<string, unknown> }) => { audits.push(p); } }));

// The one record the acting admin is NOT authorized for — every other task
// resolves successfully.
const RESTRICTED_TASK_ID = "task-restricted";
vi.mock("@/lib/workflow/access", () => ({
  assertTaskAccess: vi.fn(async (_admin: unknown, task: { id: string }) => {
    if (task.id === RESTRICTED_TASK_ID) {
      const { ApiError } = await import("@/lib/route-guard");
      throw new ApiError(403, "You do not have sufficient access to this task.");
    }
    return "MANAGE";
  }),
}));

let tasks: Map<string, { id: string; version: number; priority: string; dueAt: Date | null }>;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminTask: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => tasks.get(where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
        const row = tasks.get(where.id);
        if (!row || row.version !== where.version) return { count: 0 };
        Object.assign(row, data, { version: row.version + 1 });
        return { count: 1 };
      }),
    },
  },
}));

vi.mock("@/lib/workflow/engine", () => ({
  assignTask: vi.fn(async () => ({})),
  reassignTask: vi.fn(async () => ({})),
  transitionTask: vi.fn(async () => ({})),
  WorkflowError: class WorkflowError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

import { POST } from "./route";
import { assertTaskAccess } from "@/lib/workflow/access";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/tasks/bulk", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  audits.length = 0;
  tasks = new Map([
    ["task-1", { id: "task-1", version: 1, priority: "NORMAL", dueAt: null }],
    ["task-2", { id: "task-2", version: 1, priority: "NORMAL", dueAt: null }],
    [RESTRICTED_TASK_ID, { id: RESTRICTED_TASK_ID, version: 1, priority: "NORMAL", dueAt: null }],
  ]);
  vi.mocked(assertTaskAccess).mockClear();
});

describe("POST /api/admin/tasks/bulk — one unauthorized record never slips through", () => {
  it("applies the change to every authorized task and rejects the restricted one, without aborting the batch", async () => {
    const res = await POST(req({ action: "priority", taskIds: ["task-1", "task-2", RESTRICTED_TASK_ID], priority: "CRITICAL" }));
    const json = await res.json();

    expect(json.succeeded.sort()).toEqual(["task-1", "task-2"]);
    expect(json.failed).toEqual([{ taskId: RESTRICTED_TASK_ID, reason: expect.stringContaining("sufficient access") }]);

    // The restricted task's priority must be completely untouched.
    expect(tasks.get(RESTRICTED_TASK_ID)!.priority).toBe("NORMAL");
    expect(tasks.get("task-1")!.priority).toBe("CRITICAL");
    expect(tasks.get("task-2")!.priority).toBe("CRITICAL");
  });

  it("writes one audit entry per successfully-changed record, and none for the rejected one", async () => {
    await POST(req({ action: "priority", taskIds: ["task-1", RESTRICTED_TASK_ID], priority: "HIGH" }));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "TASK_PRIORITY_CHANGED", meta: { taskId: "task-1", bulk: true } });
  });

  it("independently re-checks every task even within the same batch — access is never granted just because an earlier task in the list passed", async () => {
    await POST(req({ action: "priority", taskIds: ["task-1", RESTRICTED_TASK_ID, "task-2"], priority: "HIGH" }));
    expect(vi.mocked(assertTaskAccess)).toHaveBeenCalledTimes(3);
  });

  it("rejects the whole request up front when the caller lacks tasks:bulk-actions entirely (not per-record)", async () => {
    const { requireAdmin } = await import("@/lib/route-guard");
    vi.mocked(requireAdmin).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const res = await POST(req({ action: "priority", taskIds: ["task-1"], priority: "HIGH" }));
    expect(res.status).toBe(403);
  });
});
