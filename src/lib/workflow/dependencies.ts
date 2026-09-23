import { prisma } from "@/lib/prisma";
import type { AdminTask } from "@prisma/client";

// STEP 18 §18 — a TaskDependency row means "taskId DEPENDS_ON
// dependsOnTaskId" (taskId cannot proceed until dependsOnTaskId completes).
// Only a COMPLETED dependency counts as satisfied — a cancelled/expired one
// still blocks, since spec §18 gives no "skip on cancel" rule and silently
// unblocking on cancellation could let work proceed on a false assumption.
export async function checkDependencies(taskId: string): Promise<{ blocked: boolean; incompleteDependencies: AdminTask[] }> {
  const deps = await prisma.taskDependency.findMany({
    where: { taskId, type: "DEPENDS_ON" },
    include: { dependsOnTask: true },
  });
  const incompleteDependencies = deps.map((d) => d.dependsOnTask).filter((t) => t.status !== "COMPLETED");
  return { blocked: incompleteDependencies.length > 0, incompleteDependencies };
}

// Prevents "Task A depends on Task B" from being added when Task B already
// (transitively) depends on Task A — that would make both tasks permanently
// unable to start. Walks the existing DEPENDS_ON graph forward from
// `dependsOnTaskId`; if `taskId` is reachable, adding the new edge would
// close a loop.
export async function wouldCreateCycle(taskId: string, dependsOnTaskId: string): Promise<boolean> {
  if (taskId === dependsOnTaskId) return true;

  const visited = new Set<string>();
  const queue = [dependsOnTaskId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const edges = await prisma.taskDependency.findMany({
      where: { taskId: current, type: "DEPENDS_ON" },
      select: { dependsOnTaskId: true },
    });
    for (const edge of edges) {
      if (!visited.has(edge.dependsOnTaskId)) queue.push(edge.dependsOnTaskId);
    }
  }

  return false;
}
