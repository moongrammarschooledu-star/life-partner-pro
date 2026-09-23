import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { createAssignment, reassignAssignment } from "@/lib/admin-assignment";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isValidTransition } from "@/lib/workflow/status";
import { findExistingOpenTask } from "@/lib/workflow/dedup";
import { checkDependencies as checkTaskDependencies } from "@/lib/workflow/dependencies";
import { computeTaskSlaDueDates, classifyTaskSla, type TaskSlaBucket } from "@/lib/workflow/sla";
import {
  notifyTaskAssigned,
  notifyTaskReassigned,
  notifyTaskEscalated,
  notifyTaskDependencyCompleted,
  notifyTaskReopened,
} from "@/lib/notifications/events";
import type { AdminTask, AdminTaskType, AdminTaskStatus, AssignmentResourceType, AssignmentPriority, AccessLevel, TaskVisibility } from "@prisma/client";

// Extends the dependency-free HttpError (not route-guard.ts's ApiError
// directly — that would pull NextAuth's whole auth.ts chain into every
// lightweight module that transitively imports this file via
// admin-tasks.ts) so every existing route's
// `catch (error) { return handleApiError(error); }` still handles it
// correctly via handleApiError's `instanceof HttpError` check.
export class WorkflowError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "WorkflowError";
  }
}

const MAX_ESCALATION_LEVEL = 4;

// ---------- createTask / createFromEvent (spec §6/§53/§54) ----------

export interface CreateTaskParams {
  taskType: AdminTaskType;
  resourceType: AssignmentResourceType;
  resourceId: string;
  title?: string | null;
  description?: string | null;
  priority?: AssignmentPriority;
  dueAt?: Date | null;
  notes?: string | null;
  assignedToId?: string | null;
  assignedDepartmentId?: string | null;
  createdById?: string | null; // null = system-created (automation)
  accessLevel?: AccessLevel;
  visibility?: TaskVisibility;
  dedupe?: boolean; // default true — skip only for the rare deliberate-duplicate case
}

// The single entry point for creating an AdminTask — every caller (manual
// "Create Task", the STEP 9 compatibility shim in admin-tasks.ts, and
// createFromEvent below) goes through this so dedup/SLA/audit/notification
// behavior is identical regardless of source.
export async function createTask(params: CreateTaskParams): Promise<AdminTask> {
  if (params.dedupe !== false) {
    const existing = await findExistingOpenTask(params.resourceType, params.resourceId, params.taskType);
    if (existing) return existing;
  }

  const taskCode = await nextSequenceCode("TASK");
  const sla = await computeTaskSlaDueDates(params.taskType);
  const status: AdminTaskStatus = params.assignedToId ? "ASSIGNED" : "NEW";

  const task = await prisma.adminTask.create({
    data: {
      taskCode,
      taskType: params.taskType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      title: params.title ?? null,
      description: params.description ?? null,
      priority: params.priority ?? "NORMAL",
      status,
      dueAt: params.dueAt ?? sla.targetResolutionAt,
      notes: params.notes ?? null,
      assignedToId: params.assignedToId ?? null,
      assignedDepartmentId: params.assignedDepartmentId ?? null,
      createdById: params.createdById ?? null,
      accessLevel: params.accessLevel ?? "MANAGE",
      visibility: params.visibility ?? "STANDARD",
    },
  });

  await writeAudit({
    action: "TASK_CREATED",
    adminId: params.createdById ?? null,
    meta: { taskId: task.id, taskCode, taskType: params.taskType, resourceType: params.resourceType, resourceId: params.resourceId },
  });

  if (params.assignedToId) {
    await createAssignment({
      adminId: params.assignedToId,
      resourceType: "ADMIN_TASK",
      resourceId: task.id,
      priority: params.priority,
      dueAt: task.dueAt,
      createdById: params.createdById ?? params.assignedToId,
    });
    await notifyTaskAssigned(params.assignedToId, taskCode, task.title ?? params.taskType);
  }

  return task;
}

export interface CreateFromEventParams {
  eventName: string;
  dedupKey: string;
  resourceType: AssignmentResourceType;
  resourceId: string;
  taskType: AdminTaskType;
  priority?: AssignmentPriority;
  title?: string | null;
  description?: string | null;
  assignedToId?: string | null;
  assignedDepartmentId?: string | null;
  payload?: unknown;
}

// System-triggered task creation (spec §6/§19/§53). Idempotent via
// WorkflowEvent.dedupKey's unique constraint: re-delivering the same event
// (e.g. a retried cron tick) never creates a second task. Never throws —
// a failure here must not break the caller's primary write (same convention
// as sendNotification()); it's recorded to WorkflowFailure instead.
export async function createFromEvent(params: CreateFromEventParams): Promise<AdminTask | null> {
  let eventId: string;
  try {
    const event = await prisma.workflowEvent.create({
      data: {
        eventName: params.eventName,
        dedupKey: params.dedupKey,
        sourceType: params.resourceType,
        sourceId: params.resourceId,
        payload: params.payload ? JSON.parse(JSON.stringify(params.payload)) : undefined,
      },
    });
    eventId = event.id;
  } catch {
    // Unique constraint on dedupKey — this exact event was already processed.
    return null;
  }

  try {
    const task = await createTask({
      taskType: params.taskType,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      title: params.title,
      description: params.description,
      priority: params.priority,
      assignedToId: params.assignedToId,
      assignedDepartmentId: params.assignedDepartmentId,
      createdById: null,
    });
    await prisma.workflowEvent.update({ where: { id: eventId }, data: { status: "PROCESSED", taskId: task.id, processedAt: new Date() } });
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.workflowEvent.update({ where: { id: eventId }, data: { status: "FAILED", lastError: message, attempts: { increment: 1 } } });
    await prisma.workflowFailure.create({
      data: { workflowEventId: eventId, stage: "TASK_CREATION", errorMessage: message },
    });
    return null;
  }
}

// ---------- assignTask / reassignTask (spec §7/§43) ----------

export async function assignTask(params: { taskId: string; adminId: string; actorId: string; priority?: AssignmentPriority; dueAt?: Date | null }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  if (task.assignedToId) {
    throw new WorkflowError(409, "This task already has an assignee — use reassign instead.");
  }

  const updated = await withVersionedUpdate(task, {
    assignedToId: params.adminId,
    status: isValidTransition(task.status, "ASSIGNED") ? "ASSIGNED" : task.status,
  });

  await createAssignment({
    adminId: params.adminId,
    resourceType: "ADMIN_TASK",
    resourceId: task.id,
    priority: params.priority ?? task.priority,
    dueAt: params.dueAt ?? task.dueAt,
    createdById: params.actorId,
  });

  await writeAudit({ action: "TASK_ASSIGNED", adminId: params.actorId, meta: { taskId: task.id, assignedToId: params.adminId } });
  await notifyTaskAssigned(params.adminId, task.taskCode ?? task.id, task.title ?? task.taskType);
  return updated;
}

export async function reassignTask(params: { taskId: string; newAdminId: string; reason: string; actorId: string }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  const previousAdminId = task.assignedToId;

  await reassignAssignment({
    resourceType: "ADMIN_TASK",
    resourceId: task.id,
    newAdminId: params.newAdminId,
    reason: params.reason,
    createdById: params.actorId,
    priority: task.priority,
    dueAt: task.dueAt,
  });

  const updated = await withVersionedUpdate(task, { assignedToId: params.newAdminId });

  await writeAudit({
    action: "TASK_REASSIGNED",
    adminId: params.actorId,
    meta: { taskId: task.id, previousAdminId, newAdminId: params.newAdminId, reason: params.reason },
  });
  await notifyTaskReassigned(params.newAdminId, task.taskCode ?? task.id, task.title ?? task.taskType);
  return updated;
}

// ---------- transitionTask (spec §4 — every status change goes through this) ----------

export async function transitionTask(params: { taskId: string; newStatus: AdminTaskStatus; actorId: string | null; reason?: string }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  if (!isValidTransition(task.status, params.newStatus)) {
    throw new WorkflowError(400, `Cannot move a task from ${task.status} to ${params.newStatus}.`);
  }

  const extra: Record<string, unknown> = {};
  if (params.newStatus === "IN_PROGRESS" && !task.startedAt) extra.startedAt = new Date();

  const updated = await withVersionedUpdate(task, { status: params.newStatus, ...extra });

  await prisma.taskStatusHistory.create({
    data: { taskId: task.id, previousStatus: task.status, newStatus: params.newStatus, changedById: params.actorId, reason: params.reason ?? null },
  });
  await writeAudit({
    action: "TASK_STATUS_CHANGED",
    adminId: params.actorId,
    meta: { taskId: task.id, previousStatus: task.status, newStatus: params.newStatus, reason: params.reason ?? null },
  });
  return updated;
}

// ---------- escalateTask (spec §22/§23 — 4-level ladder, never an automatic adverse decision) ----------

export async function escalateTask(params: { taskId: string; actorId: string | null; reason: string; auto?: boolean }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  if (task.escalationLevel >= MAX_ESCALATION_LEVEL) {
    throw new WorkflowError(409, `This task is already at the highest escalation level (${MAX_ESCALATION_LEVEL}).`);
  }
  const newLevel = task.escalationLevel + 1;
  const nextStatus: AdminTaskStatus = isValidTransition(task.status, "ESCALATED") ? "ESCALATED" : task.status;

  const updated = await withVersionedUpdate(task, { escalationLevel: newLevel, escalationStatus: "ESCALATED", status: nextStatus });

  await prisma.taskEscalation.create({
    data: { taskId: task.id, previousLevel: task.escalationLevel, newLevel, reason: params.reason, escalatedById: params.actorId },
  });
  await writeAudit({ action: "TASK_ESCALATED", adminId: params.actorId, meta: { taskId: task.id, previousLevel: task.escalationLevel, newLevel, reason: params.reason, auto: !!params.auto } });
  await notifyTaskEscalated(task.assignedToId, task.taskCode ?? task.id, task.title ?? task.taskType);
  return updated;
}

// ---------- completeTask (spec §55/§56) ----------

export async function completeTask(params: { taskId: string; actorId: string; outcome?: string | null; completionNotes?: string | null; overrideChecklist?: boolean }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  if (!isValidTransition(task.status, "COMPLETED")) {
    throw new WorkflowError(400, `Cannot complete a task in status ${task.status}.`);
  }

  if (!params.overrideChecklist) {
    const incompleteRequired = await prisma.taskChecklistItem.count({ where: { taskId: task.id, required: true, completedAt: null } });
    if (incompleteRequired > 0) {
      throw new WorkflowError(400, "This task has required checklist items that are not yet complete.");
    }
  }

  const updated = await withVersionedUpdate(task, {
    status: "COMPLETED",
    completedAt: new Date(),
    outcome: params.outcome ?? task.outcome,
    completionNotes: params.completionNotes ?? task.completionNotes,
  });

  await prisma.taskStatusHistory.create({ data: { taskId: task.id, previousStatus: task.status, newStatus: "COMPLETED", changedById: params.actorId } });
  await writeAudit({ action: "TASK_COMPLETED", adminId: params.actorId, meta: { taskId: task.id, outcome: params.outcome ?? null } });

  // Spec §16/§18 — notify anything that depended on this task.
  const dependents = await prisma.taskDependency.findMany({ where: { dependsOnTaskId: task.id, type: "DEPENDS_ON" }, include: { task: true } });
  for (const dep of dependents) {
    if (dep.task.assignedToId) {
      await notifyTaskDependencyCompleted(dep.task.assignedToId, dep.task.taskCode ?? dep.task.id, dep.task.title ?? dep.task.taskType);
    }
  }

  return updated;
}

// ---------- reopenTask / cancelTask (spec §46) ----------

export async function reopenTask(params: { taskId: string; actorId: string; reason: string }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  if (!isValidTransition(task.status, "REOPENED")) {
    throw new WorkflowError(400, `Cannot reopen a task in status ${task.status}.`);
  }
  const updated = await withVersionedUpdate(task, { status: "REOPENED", completedAt: null });

  await prisma.taskStatusHistory.create({ data: { taskId: task.id, previousStatus: task.status, newStatus: "REOPENED", changedById: params.actorId, reason: params.reason } });
  await writeAudit({ action: "TASK_REOPENED", adminId: params.actorId, meta: { taskId: task.id, reason: params.reason } });
  await notifyTaskReopened(task.assignedToId, task.taskCode ?? task.id, task.title ?? task.taskType);
  return updated;
}

export async function cancelTask(params: { taskId: string; actorId: string; reason: string }): Promise<AdminTask> {
  const task = await requireTask(params.taskId);
  if (!isValidTransition(task.status, "CANCELLED")) {
    throw new WorkflowError(400, `Cannot cancel a task in status ${task.status}.`);
  }
  const updated = await withVersionedUpdate(task, { status: "CANCELLED" });

  await prisma.taskStatusHistory.create({ data: { taskId: task.id, previousStatus: task.status, newStatus: "CANCELLED", changedById: params.actorId, reason: params.reason } });
  await writeAudit({ action: "TASK_CANCELLED", adminId: params.actorId, meta: { taskId: task.id, reason: params.reason } });
  return updated;
}

// ---------- checkDependencies / checkSLA (spec §18/§20 — thin re-exports for engine callers) ----------

export const checkDependencies = checkTaskDependencies;

export async function checkSLA(taskId: string): Promise<TaskSlaBucket | null> {
  const task = await requireTask(taskId);
  const sla = await computeTaskSlaDueDates(task.taskType);
  return classifyTaskSla({
    targetResolutionAt: task.dueAt ?? sla.targetResolutionAt,
    warningAt: sla.warningAt,
    escalated: task.escalationStatus === "ESCALATED",
    paused: false,
  });
}

// ---------- internal helpers ----------

async function requireTask(taskId: string): Promise<AdminTask> {
  const task = await prisma.adminTask.findUnique({ where: { id: taskId } });
  if (!task) throw new WorkflowError(404, "Task not found.");
  return task;
}

// Optimistic concurrency (spec §47) — every mutation bumps `version`; a
// caller holding a stale version number gets a 409 instead of silently
// clobbering someone else's concurrent update.
async function withVersionedUpdate(task: AdminTask, data: Record<string, unknown>): Promise<AdminTask> {
  const result = await prisma.adminTask.updateMany({
    where: { id: task.id, version: task.version },
    data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
  });
  if (result.count === 0) {
    throw new WorkflowError(409, "This task was modified by someone else — reload and try again.");
  }
  return prisma.adminTask.findUniqueOrThrow({ where: { id: task.id } });
}
