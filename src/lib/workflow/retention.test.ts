import { describe, it, expect, vi, beforeEach } from "vitest";

const { transitionTask } = vi.hoisted(() => ({ transitionTask: vi.fn(async () => ({})) }));
vi.mock("@/lib/workflow/engine", () => ({ transitionTask }));

let policy: { retentionDays: number; isActive: boolean; action: string } | null;
let hasActiveHoldResult = false;
vi.mock("@/lib/privacy/retention-policy", () => ({ getRetentionPolicy: async () => policy }));
vi.mock("@/lib/privacy/data-hold", () => ({ hasActiveHold: async () => hasActiveHoldResult }));

let tasks: Array<{ id: string; resourceType: string; resourceId: string }>;
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adminTask: { findMany: vi.fn(async () => tasks) },
  },
}));

import { runTaskRetentionActions } from "@/lib/workflow/retention";

beforeEach(() => {
  policy = { retentionDays: 90, isActive: true, action: "ARCHIVE" };
  hasActiveHoldResult = false;
  tasks = [{ id: "t1", resourceType: "PROFILE", resourceId: "p1" }];
  transitionTask.mockClear();
});

describe("runTaskRetentionActions", () => {
  it("archives an eligible task", async () => {
    const result = await runTaskRetentionActions();
    expect(result.archived).toBe(1);
    expect(transitionTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", newStatus: "ARCHIVED" }));
  });

  it("does nothing when there is no active WORKFLOW_TASK_DATA policy", async () => {
    policy = null;
    const result = await runTaskRetentionActions();
    expect(result.archived).toBe(0);
    expect(transitionTask).not.toHaveBeenCalled();
  });

  it("does nothing when the policy is inactive", async () => {
    policy!.isActive = false;
    const result = await runTaskRetentionActions();
    expect(result.archived).toBe(0);
  });

  it("does nothing when the policy action is not ARCHIVE (e.g. REVIEW_REQUIRED)", async () => {
    policy!.action = "REVIEW_REQUIRED";
    const result = await runTaskRetentionActions();
    expect(result.archived).toBe(0);
    expect(transitionTask).not.toHaveBeenCalled();
  });

  it("skips a task under an active legal/administrative hold", async () => {
    hasActiveHoldResult = true;
    const result = await runTaskRetentionActions();
    expect(result.archived).toBe(0);
    expect(result.skippedHold).toBe(1);
    expect(transitionTask).not.toHaveBeenCalled();
  });

  it("never throws when a task's transition fails — just skips it", async () => {
    transitionTask.mockRejectedValueOnce(new Error("invalid transition"));
    const result = await runTaskRetentionActions();
    expect(result.archived).toBe(0);
  });
});
