import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { createTask } from "@/lib/workflow/engine";
import type { AdminTaskType } from "@prisma/client";

const MAX_RETRY_ATTEMPTS = 5;

// STEP 18 §65/§66 — retries a FAILED WorkflowEvent by re-attempting task
// creation from its stored payload. Never silently discards an event: after
// MAX_RETRY_ATTEMPTS it stays FAILED with its WorkflowFailure row intact,
// visible in Admin → Workflow Failures for a human to inspect/retry/resolve.
export async function retryWorkflowEvent(eventId: string, actorId: string | null): Promise<{ ok: boolean; error?: string }> {
  const event = await prisma.workflowEvent.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: "Workflow event not found." };
  if (event.status === "PROCESSED") return { ok: true };
  if (event.attempts >= MAX_RETRY_ATTEMPTS) {
    return { ok: false, error: `Already retried ${event.attempts} times — resolve manually.` };
  }

  try {
    const payload = (event.payload ?? {}) as { taskType?: AdminTaskType; title?: string; description?: string; assignedToId?: string; assignedDepartmentId?: string };
    if (!payload.taskType) throw new Error("Stored event payload is missing taskType — cannot retry automatically.");

    const task = await createTask({
      taskType: payload.taskType,
      resourceType: event.sourceType,
      resourceId: event.sourceId,
      title: payload.title,
      description: payload.description,
      assignedToId: payload.assignedToId,
      assignedDepartmentId: payload.assignedDepartmentId,
      createdById: null,
    });

    await prisma.workflowEvent.update({ where: { id: eventId }, data: { status: "PROCESSED", taskId: task.id, processedAt: new Date() } });
    if (actorId) {
      await writeAudit({ action: "WORKFLOW_FAILURE_RETRIED", adminId: actorId, meta: { workflowEventId: eventId, taskId: task.id } });
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.workflowEvent.update({ where: { id: eventId }, data: { status: "FAILED", lastError: message, attempts: { increment: 1 } } });
    await prisma.workflowFailure.create({ data: { workflowEventId: eventId, stage: "TASK_CREATION", errorMessage: message } });
    return { ok: false, error: message };
  }
}

export async function resolveWorkflowFailure(failureId: string, actorId: string, resolution: "RESOLVED" | "IGNORED", reason?: string): Promise<void> {
  await prisma.workflowFailure.update({
    where: { id: failureId },
    data: { resolvedAt: new Date(), resolvedById: actorId, resolution, resolutionReason: reason ?? null },
  });
  await writeAudit({ action: "WORKFLOW_FAILURE_RESOLVED", adminId: actorId, meta: { failureId, resolution, reason: reason ?? null } });
}
