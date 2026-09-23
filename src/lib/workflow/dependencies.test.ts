import { describe, it, expect, vi, beforeEach } from "vitest";

interface DepRow {
  taskId: string;
  dependsOnTaskId: string;
  type: string;
}
interface TaskRow {
  id: string;
  status: string;
}

let deps: DepRow[];
let taskRows: Record<string, TaskRow>;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    taskDependency: {
      findMany: vi.fn(({ where, include, select }: { where: { taskId: string; type: string }; include?: unknown; select?: unknown }) => {
        const matches = deps.filter((d) => d.taskId === where.taskId && d.type === where.type);
        if (include) {
          return Promise.resolve(matches.map((d) => ({ ...d, dependsOnTask: taskRows[d.dependsOnTaskId] })));
        }
        if (select) {
          return Promise.resolve(matches.map((d) => ({ dependsOnTaskId: d.dependsOnTaskId })));
        }
        return Promise.resolve(matches);
      }),
    },
  },
}));

import { checkDependencies, wouldCreateCycle } from "@/lib/workflow/dependencies";

beforeEach(() => {
  deps = [];
  taskRows = {};
});

describe("checkDependencies", () => {
  it("is not blocked when there are no dependencies", async () => {
    const result = await checkDependencies("t1");
    expect(result.blocked).toBe(false);
    expect(result.incompleteDependencies).toEqual([]);
  });

  it("is blocked while a dependency is not COMPLETED", async () => {
    deps = [{ taskId: "t1", dependsOnTaskId: "t2", type: "DEPENDS_ON" }];
    taskRows = { t2: { id: "t2", status: "IN_PROGRESS" } };
    const result = await checkDependencies("t1");
    expect(result.blocked).toBe(true);
    expect(result.incompleteDependencies.map((t) => t.id)).toEqual(["t2"]);
  });

  it("is not blocked once every dependency is COMPLETED", async () => {
    deps = [{ taskId: "t1", dependsOnTaskId: "t2", type: "DEPENDS_ON" }];
    taskRows = { t2: { id: "t2", status: "COMPLETED" } };
    const result = await checkDependencies("t1");
    expect(result.blocked).toBe(false);
  });

  it("still counts a CANCELLED dependency as incomplete (no silent skip-on-cancel)", async () => {
    deps = [{ taskId: "t1", dependsOnTaskId: "t2", type: "DEPENDS_ON" }];
    taskRows = { t2: { id: "t2", status: "CANCELLED" } };
    const result = await checkDependencies("t1");
    expect(result.blocked).toBe(true);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects a task depending on itself", async () => {
    expect(await wouldCreateCycle("t1", "t1")).toBe(true);
  });

  it("allows a fresh, non-circular dependency", async () => {
    expect(await wouldCreateCycle("t1", "t2")).toBe(false);
  });

  it("detects a direct 2-node cycle (t2 already depends on t1)", async () => {
    deps = [{ taskId: "t2", dependsOnTaskId: "t1", type: "DEPENDS_ON" }];
    // Adding "t1 depends on t2" would close the loop t1 -> t2 -> t1.
    expect(await wouldCreateCycle("t1", "t2")).toBe(true);
  });

  it("detects a longer transitive cycle (t3 -> t2 -> t1)", async () => {
    deps = [
      { taskId: "t3", dependsOnTaskId: "t2", type: "DEPENDS_ON" },
      { taskId: "t2", dependsOnTaskId: "t1", type: "DEPENDS_ON" },
    ];
    // Adding "t1 depends on t3" would close t1 -> t3 -> t2 -> t1.
    expect(await wouldCreateCycle("t1", "t3")).toBe(true);
  });

  it("does not flag an unrelated branch as a cycle", async () => {
    deps = [{ taskId: "t3", dependsOnTaskId: "t4", type: "DEPENDS_ON" }];
    expect(await wouldCreateCycle("t1", "t2")).toBe(false);
  });
});
