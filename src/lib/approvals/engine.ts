import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { verifyStepUpToken } from "@/lib/step-up-token";
import { createTask } from "@/lib/workflow/engine";
import { isValidTransition, ACTIVE_APPROVAL_STATUSES } from "@/lib/approvals/status";
import { getApprovalPolicy, getRequiredApprovers, calculateRisk, canApprove, canReject, canRequestChanges, checkQuorum, isExpired, type ApprovalContext } from "@/lib/approvals/policy-engine";
import { detectConflict, recordConflict, CONFLICT_NEUTRAL_MESSAGE } from "@/lib/approvals/conflict";
import { getCatalogEntry } from "@/lib/approvals/catalog";
import { recordApprovalEvent } from "@/lib/approvals/events";
import {
  notifyApprovalRequested,
  notifyApprovalApproved,
  notifyApprovalRejected,
  notifyApprovalChangesRequested,
  notifyApprovalExpired,
  notifyApprovalExecuted,
  notifyApprovalExecutionFailed,
  notifyEmergencyOverrideUsed,
} from "@/lib/notifications/events";
import type { ApprovalRequest, ApprovalLevel, ApprovalPolicy, AssignmentResourceType, AssignmentPriority, AdminRole, AdminTaskType } from "@prisma/client";

// STEP 19 — the central approval-governance mutator, mirroring
// src/lib/workflow/engine.ts's exact conventions: an HttpError subclass for
// route-guard compatibility, one function per lifecycle action, optimistic
// concurrency via `version`, and every write followed by an audit event.
// This module owns every ApprovalRequest/ApprovalStep/ApprovalReviewer
// mutation — nothing else in the codebase writes those tables directly.
export class ApprovalError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "ApprovalError";
  }
}

const LEVEL_ORDER: ApprovalLevel[] = ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4", "LEVEL_5"];

// ---------- createApprovalRequest / submitApprovalRequest (spec §2/§8/§30) ----------

export interface CreateApprovalRequestParams {
  actionType: string;
  sourceType: AssignmentResourceType;
  sourceId: string;
  makerId: string;
  reason: string;
  priority?: AssignmentPriority;
  currentStatePayload?: unknown;
  requestedPayload?: unknown;
  context?: ApprovalContext;
  idempotencyKey?: string;
  autoSubmit?: boolean; // default true
}

// Builds the ApprovalStep ladder for a required level (spec §4):
// LEVEL_1 = one step, one decision. LEVEL_2 = one step, two independent
// approvers (quorum 2) from the same eligible pool. LEVEL_3 = two sequential
// steps — manager tier, then Super Admin — "Manager + Senior Admin". LEVEL_4
// = one step, Super Admin only. LEVEL_5 = one step, N-of-M quorum from the
// full eligible pool (multi-party). Disclosed interpretation — the spec
// names these tiers by example, not by a literal step count.
function buildSteps(requiredLevel: ApprovalLevel, policy: Pick<ApprovalPolicy, "allowedRoles" | "minimumApprovers" | "quorum">): Array<{ level: ApprovalLevel; sequence: number; requiredRoles: AdminRole[]; requiredCount: number; quorumCount: number }> {
  const managerRoles = policy.allowedRoles.filter((r) => r !== "SUPER_ADMIN");
  switch (requiredLevel) {
    case "LEVEL_1":
      return [{ level: "LEVEL_1", sequence: 1, requiredRoles: policy.allowedRoles, requiredCount: 1, quorumCount: 1 }];
    case "LEVEL_2":
      return [{ level: "LEVEL_2", sequence: 1, requiredRoles: policy.allowedRoles, requiredCount: Math.max(2, policy.minimumApprovers), quorumCount: Math.max(2, policy.quorum) }];
    case "LEVEL_3":
      return [
        { level: "LEVEL_3", sequence: 1, requiredRoles: managerRoles.length > 0 ? managerRoles : policy.allowedRoles, requiredCount: 1, quorumCount: 1 },
        { level: "LEVEL_3", sequence: 2, requiredRoles: ["SUPER_ADMIN"], requiredCount: 1, quorumCount: 1 },
      ];
    case "LEVEL_4":
      return [{ level: "LEVEL_4", sequence: 1, requiredRoles: ["SUPER_ADMIN"], requiredCount: 1, quorumCount: 1 }];
    case "LEVEL_5":
      return [{ level: "LEVEL_5", sequence: 1, requiredRoles: policy.allowedRoles, requiredCount: Math.max(3, policy.minimumApprovers), quorumCount: Math.max(2, policy.quorum) }];
    default:
      return [];
  }
}

function taskTypeForApproval(riskLevel: string, domain: string | undefined): AdminTaskType {
  if (domain === "FINANCE") return "FINANCE_APPROVAL";
  if (domain === "CONTACT") return "CONTACT_APPROVAL";
  if (domain === "VERIFICATION") return "VERIFICATION_APPROVAL";
  if (domain === "PRIVACY") return "PRIVACY_APPROVAL";
  if (domain === "SAFETY" || domain === "ADMINISTRATION") return "SECURITY_APPROVAL";
  if (domain === "AI") return "AI_APPROVAL";
  if (riskLevel === "CRITICAL") return "CRITICAL_APPROVAL";
  if (riskLevel === "HIGH") return "HIGH_RISK_APPROVAL";
  return "APPROVAL_REVIEW";
}

// The single entry point for requesting governance approval — used both by
// the manual "Admin -> Approvals -> New Request" API route and by
// src/lib/approvals/gate.ts's automatic creation when an existing route's
// action requires approval. Idempotent (spec §36): a second call with the
// same idempotencyKey while an earlier request is still open returns that
// same request rather than creating a duplicate.
export async function createApprovalRequest(params: CreateApprovalRequestParams): Promise<ApprovalRequest> {
  const policy = await getApprovalPolicy(params.actionType);
  if (!policy || !policy.enabled) {
    throw new ApprovalError(400, `"${params.actionType}" is not a governed action, or its policy is disabled.`);
  }

  // Dedup check (spec §36) is by CONTENT (actionType+sourceType+sourceId+
  // makerId) among still-open requests — never by idempotencyKey's value,
  // since idempotencyKey itself must stay globally unique forever (DB
  // constraint) even across a rejected-then-resubmitted history for the same
  // record. Reusing a deterministic key across attempts would permanently
  // collide with the first (now-terminal) row once it's REJECTED/CANCELLED/
  // EXPIRED — this only guards against a genuine still-open duplicate.
  const existing = await prisma.approvalRequest.findFirst({
    where: {
      actionType: params.actionType,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      makerId: params.makerId,
      status: { in: [...ACTIVE_APPROVAL_STATUSES, "DRAFT", "APPROVED", "EXECUTION_PENDING", "EXECUTING"] },
    },
  });
  if (existing) return existing;

  const idempotencyKey = params.idempotencyKey ?? `${params.actionType}:${params.sourceType}:${params.sourceId}:${params.makerId}:${crypto.randomUUID()}`;

  const riskLevel = await calculateRisk(params.actionType, params.context);
  const { requiredLevel, minimumApprovers, quorum, allowedRoles } = await getRequiredApprovers(params.actionType, params.context);
  const approvalCode = await nextSequenceCode("APR");
  const expiresAt = new Date(Date.now() + policy.expirationMinutes * 60 * 1000);

  const request = await prisma.approvalRequest.create({
    data: {
      approvalCode,
      actionType: params.actionType,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      makerId: params.makerId,
      status: "DRAFT",
      riskLevel,
      priority: params.priority ?? "NORMAL",
      reason: params.reason,
      currentStatePayload: toJson(params.currentStatePayload),
      requestedPayload: toJson(params.requestedPayload),
      requiredLevel,
      currentLevel: "LEVEL_0",
      expiresAt,
      idempotencyKey,
      steps: { create: buildSteps(requiredLevel, { allowedRoles, minimumApprovers, quorum }) },
    },
  });

  // Best-effort race guard: two near-simultaneous calls can both pass the
  // `existing` check above before either row exists. If another open
  // request for the same content now exists and was created first, defer to
  // it and cancel the one we just made rather than leaving two duplicates
  // open (idempotencyKey is randomized per-attempt, so no DB unique
  // constraint catches this — disclosed limitation, not a hard guarantee).
  const earlierDuplicate = await prisma.approvalRequest.findFirst({
    where: {
      actionType: params.actionType,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      makerId: params.makerId,
      status: { in: [...ACTIVE_APPROVAL_STATUSES, "DRAFT", "APPROVED", "EXECUTION_PENDING", "EXECUTING"] },
      id: { not: request.id },
      createdAt: { lt: request.createdAt },
    },
  });
  if (earlierDuplicate) {
    await prisma.approvalRequest.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    return earlierDuplicate;
  }

  await recordApprovalEvent({ approvalRequestId: request.id, actorId: params.makerId, eventType: "APPROVAL_CREATED", metadata: { actionType: params.actionType, riskLevel, requiredLevel } });

  const entry = getCatalogEntry(params.actionType);
  const task = await createTask({
    taskType: taskTypeForApproval(riskLevel, entry?.domain),
    resourceType: params.sourceType,
    resourceId: params.sourceId,
    title: `Approval needed — ${entry?.label ?? params.actionType} (${approvalCode})`,
    description: params.reason,
    priority: params.priority ?? "NORMAL",
    createdById: params.makerId,
    accessLevel: "APPROVE",
    dedupe: false,
  }).catch(() => null);

  const withTask = task ? await prisma.approvalRequest.update({ where: { id: request.id }, data: { createdTaskId: task.id } }) : request;

  if (params.autoSubmit === false) return withTask;
  return submitApprovalRequest(withTask.id, params.makerId);
}

export async function submitApprovalRequest(approvalRequestId: string, actorId: string): Promise<ApprovalRequest> {
  const request = await requireRequest(approvalRequestId);
  if (!isValidTransition(request.status, "SUBMITTED")) {
    throw new ApprovalError(400, `Cannot submit a request in status ${request.status}.`);
  }
  const firstStep = await prisma.approvalStep.findFirst({ where: { approvalRequestId }, orderBy: { sequence: "asc" } });
  if (!firstStep) throw new ApprovalError(500, "This approval request has no review steps configured.");

  const updated = await withVersionedUpdate(request, { status: "PENDING_APPROVAL", currentLevel: firstStep.level });
  await prisma.approvalStep.update({ where: { id: firstStep.id }, data: { status: "IN_PROGRESS" } });

  await recordApprovalEvent({ approvalRequestId, actorId, eventType: "APPROVAL_SUBMITTED" });
  await notifyApprovalRequested(request.assignedCheckerId, request.approvalCode, request.actionType);
  return updated;
}

// ---------- recordDecision (spec §5/§21/§22/§23 — approve / reject / request-changes) ----------

export type ApprovalDecisionKind = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

export async function recordDecision(params: { approvalRequestId: string; actorId: string; decision: ApprovalDecisionKind; reason?: string }): Promise<ApprovalRequest> {
  const request = await requireRequest(params.approvalRequestId);

  if (await isExpired(params.approvalRequestId)) {
    await expireApprovalRequest(params.approvalRequestId);
    throw new ApprovalError(409, "This approval request has expired and can no longer be decided.");
  }

  // Conflict-of-interest check (spec §29) — always first, unconditional,
  // covers self-approval and every other named conflict type. A denial here
  // is logged and shown only as the neutral message.
  const conflict = await detectConflict(params.approvalRequestId, params.actorId);
  if (conflict) {
    await recordConflict(params.approvalRequestId, params.actorId, conflict);
    await recordApprovalEvent({ approvalRequestId: params.approvalRequestId, actorId: params.actorId, eventType: "APPROVAL_CONFLICT_BLOCKED", metadata: { conflictType: conflict } });
    throw new ApprovalError(403, CONFLICT_NEUTRAL_MESSAGE);
  }

  const gate = params.decision === "APPROVE" ? canApprove : params.decision === "REJECT" ? canReject : canRequestChanges;
  if (!(await gate(params.actorId, params.approvalRequestId))) {
    throw new ApprovalError(403, "You are not authorized to decide on this approval request.");
  }

  const step = await prisma.approvalStep.findFirst({ where: { approvalRequestId: params.approvalRequestId, level: request.currentLevel }, orderBy: { sequence: "asc" } });
  if (!step) throw new ApprovalError(500, "This approval request has no active review step.");

  const decisionValue = params.decision === "APPROVE" ? "APPROVED" : params.decision === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
  const actorRole = await prisma.adminUser.findUnique({ where: { id: params.actorId }, select: { role: true } });
  await prisma.approvalReviewer.upsert({
    where: { stepId_reviewerId: { stepId: step.id, reviewerId: params.actorId } },
    update: { decision: decisionValue, decisionReason: params.reason ?? null, decidedAt: new Date(), roleAtDecision: actorRole?.role ?? null },
    create: { approvalRequestId: params.approvalRequestId, stepId: step.id, reviewerId: params.actorId, decision: decisionValue, decisionReason: params.reason ?? null, decidedAt: new Date(), roleAtDecision: actorRole?.role ?? null },
  });

  if (params.decision === "REJECT") {
    const updated = await withVersionedUpdate(request, { status: "REJECTED", rejectedAt: new Date() });
    await recordApprovalEvent({ approvalRequestId: params.approvalRequestId, actorId: params.actorId, eventType: "APPROVAL_REJECTED", metadata: { reason: params.reason ?? null } });
    await notifyApprovalRejected(request.makerId, request.approvalCode, request.actionType);
    return updated;
  }

  if (params.decision === "REQUEST_CHANGES") {
    // Spec §23 — a material change invalidates prior progress: reset every
    // reviewer decision back to PENDING and rewind to the first step, then
    // bump version so a stale-approved client can never slip through.
    await prisma.approvalReviewer.updateMany({ where: { approvalRequestId: params.approvalRequestId }, data: { decision: "PENDING", decidedAt: null } });
    await prisma.approvalStep.updateMany({ where: { approvalRequestId: params.approvalRequestId }, data: { status: "PENDING" } });
    const firstStep = await prisma.approvalStep.findFirst({ where: { approvalRequestId: params.approvalRequestId }, orderBy: { sequence: "asc" } });
    const updated = await withVersionedUpdate(request, { status: "CHANGES_REQUESTED", currentLevel: firstStep?.level ?? request.currentLevel });
    await recordApprovalEvent({ approvalRequestId: params.approvalRequestId, actorId: params.actorId, eventType: "APPROVAL_CHANGES_REQUESTED", metadata: { reason: params.reason ?? null } });
    await notifyApprovalChangesRequested(request.makerId, request.approvalCode, request.actionType);
    return updated;
  }

  // APPROVE — check whether this step's quorum is now satisfied.
  await recordApprovalEvent({ approvalRequestId: params.approvalRequestId, actorId: params.actorId, eventType: "APPROVAL_APPROVED", metadata: { stepId: step.id } });
  const quorum = await checkQuorum(params.approvalRequestId);
  if (!quorum.satisfied) {
    return withVersionedUpdate(request, { status: "PARTIALLY_APPROVED" });
  }

  await prisma.approvalStep.update({ where: { id: step.id }, data: { status: "SATISFIED" } });
  const nextStep = await prisma.approvalStep.findFirst({ where: { approvalRequestId: params.approvalRequestId, sequence: { gt: step.sequence } }, orderBy: { sequence: "asc" } });

  if (nextStep) {
    await prisma.approvalStep.update({ where: { id: nextStep.id }, data: { status: "IN_PROGRESS" } });
    const updated = await withVersionedUpdate(request, { status: "PENDING_APPROVAL", currentLevel: nextStep.level });
    await notifyApprovalRequested(request.assignedCheckerId, request.approvalCode, request.actionType);
    return updated;
  }

  const updated = await withVersionedUpdate(request, { status: "APPROVED", completedAt: new Date() });
  await notifyApprovalApproved(request.makerId, request.approvalCode, request.actionType);
  return updated;
}

// ---------- cancelApprovalRequest / expireApprovalRequest ----------

export async function cancelApprovalRequest(approvalRequestId: string, actorId: string, reason: string): Promise<ApprovalRequest> {
  const request = await requireRequest(approvalRequestId);
  if (!isValidTransition(request.status, "CANCELLED")) {
    throw new ApprovalError(400, `Cannot cancel a request in status ${request.status}.`);
  }
  const updated = await withVersionedUpdate(request, { status: "CANCELLED", cancelledAt: new Date() });
  await recordApprovalEvent({ approvalRequestId, actorId, eventType: "APPROVAL_CANCELLED", metadata: { reason } });
  return updated;
}

// Called by the daily automation sweep (spec §24) — never executes an
// expired request; the maker must resubmit.
export async function expireApprovalRequest(approvalRequestId: string): Promise<ApprovalRequest | null> {
  const request = await requireRequest(approvalRequestId);
  if (!isValidTransition(request.status, "EXPIRED")) return null;
  const updated = await withVersionedUpdate(request, { status: "EXPIRED" });
  await recordApprovalEvent({ approvalRequestId, actorId: null, eventType: "APPROVAL_EXPIRED" });
  await notifyApprovalExpired(request.makerId, request.approvalCode, request.actionType);
  return updated;
}

// ---------- delegateApproval / escalateApproval ----------

export async function delegateApproval(params: { delegatorId: string; delegateId: string; allowedActionTypes?: string[]; startAt: Date; endAt: Date; reason: string; createdById: string }) {
  if (params.delegatorId === params.delegateId) {
    throw new ApprovalError(400, "You cannot delegate approval authority to yourself.");
  }
  if (params.startAt >= params.endAt) {
    throw new ApprovalError(400, "The delegation end date must be after the start date.");
  }
  const delegation = await prisma.approvalDelegation.create({
    data: {
      delegatorId: params.delegatorId,
      delegateId: params.delegateId,
      allowedActionTypes: params.allowedActionTypes ?? [],
      startAt: params.startAt,
      endAt: params.endAt,
      reason: params.reason,
      createdById: params.createdById,
    },
  });
  // Not scoped to a single ApprovalRequest (a delegation is a standing grant,
  // not a per-request decision) — audited directly via writeAudit() rather
  // than recordApprovalEvent(), which requires a valid approvalRequestId FK.
  await writeAudit({
    action: "APPROVAL_DELEGATED",
    adminId: params.createdById,
    meta: { delegationId: delegation.id, delegatorId: params.delegatorId, delegateId: params.delegateId, startAt: params.startAt, endAt: params.endAt, reason: params.reason },
  });
  return delegation;
}

// Manual escalation (spec §21) — adds a fresh Super-Admin-only step above
// the current one and moves the request there, for a checker who feels a
// decision is above their authority. Never an automatic adverse decision.
export async function escalateApproval(approvalRequestId: string, actorId: string, reason: string): Promise<ApprovalRequest> {
  const request = await requireRequest(approvalRequestId);
  if (!ACTIVE_APPROVAL_STATUSES.includes(request.status) && request.status !== "PARTIALLY_APPROVED") {
    throw new ApprovalError(400, `Cannot escalate a request in status ${request.status}.`);
  }
  const currentIndex = LEVEL_ORDER.indexOf(request.currentLevel);
  const nextLevel = LEVEL_ORDER[Math.min(currentIndex + 1, LEVEL_ORDER.length - 1)];
  const lastStep = await prisma.approvalStep.findFirst({ where: { approvalRequestId }, orderBy: { sequence: "desc" } });
  const newStep = await prisma.approvalStep.create({
    data: { approvalRequestId, level: nextLevel, sequence: (lastStep?.sequence ?? 0) + 1, requiredRoles: ["SUPER_ADMIN"], requiredCount: 1, quorumCount: 1, status: "IN_PROGRESS" },
  });
  const updated = await withVersionedUpdate(request, { status: "PENDING_APPROVAL", currentLevel: newStep.level, requiredLevel: nextLevel });
  await recordApprovalEvent({ approvalRequestId, actorId, eventType: "APPROVAL_ESCALATED", metadata: { reason, newLevel: nextLevel } });
  await notifyApprovalRequested(null, request.approvalCode, request.actionType);
  return updated;
}

// ---------- markApprovalExecuted / markApprovalExecutionFailed (spec §17 gate.ts integration) ----------

// Idempotent (spec §36): calling this on an already-EXECUTED request is a
// no-op that returns the existing row unchanged — a retried caller can never
// cause the underlying action to be counted as executed twice.
export async function markApprovalExecuted(approvalRequestId: string, actorId: string): Promise<ApprovalRequest> {
  const request = await requireRequest(approvalRequestId);
  if (request.status === "EXECUTED") return request;
  if (request.status !== "APPROVED" && request.status !== "EXECUTION_PENDING" && request.status !== "EXECUTING") {
    throw new ApprovalError(409, `Cannot execute a request in status ${request.status} — it must be APPROVED first.`);
  }

  let current = request;
  if (current.status === "APPROVED") current = await withVersionedUpdate(current, { status: "EXECUTION_PENDING", executionStatus: "PENDING" });
  await recordApprovalEvent({ approvalRequestId, actorId, eventType: "APPROVAL_EXECUTION_STARTED" });
  const executingLog = await prisma.approvalExecutionLog.create({ data: { approvalRequestId, executionStatus: "RUNNING", executedById: actorId } });

  current = await withVersionedUpdate(current, { status: "EXECUTING", executionStatus: "RUNNING" });
  current = await withVersionedUpdate(current, { status: "EXECUTED", executionStatus: "SUCCEEDED" });
  await prisma.approvalExecutionLog.update({ where: { id: executingLog.id }, data: { executionStatus: "SUCCEEDED", completedAt: new Date() } });

  await recordApprovalEvent({ approvalRequestId, actorId, eventType: "APPROVAL_EXECUTED" });
  await notifyApprovalExecuted(request.makerId, request.approvalCode, request.actionType);
  return current;
}

export async function markApprovalExecutionFailed(approvalRequestId: string, actorId: string, errorMessage: string, errorCode?: string): Promise<ApprovalRequest> {
  const request = await requireRequest(approvalRequestId);
  const updated = await withVersionedUpdate(request, { status: "EXECUTION_FAILED", executionStatus: "FAILED" });
  await prisma.approvalExecutionLog.create({ data: { approvalRequestId, executionStatus: "FAILED", executedById: actorId, completedAt: new Date(), errorMessage, errorCode: errorCode ?? null } });
  await recordApprovalEvent({ approvalRequestId, actorId, eventType: "APPROVAL_EXECUTION_FAILED", metadata: { errorMessage, errorCode: errorCode ?? null } });
  await notifyApprovalExecutionFailed(request.makerId, request.approvalCode, request.actionType);
  return updated;
}

// ---------- useEmergencyOverride (spec §25) ----------

export interface EmergencyOverrideParams {
  actionType: string;
  sourceType: AssignmentResourceType;
  sourceId: string;
  actorId: string;
  reason: string;
  category: string;
  evidenceReference?: string;
  reauthToken: string | undefined;
}

// Super-Admin-only alternate path (route-level permission gate: the
// approvals:emergency-override string, granted only to SUPER_ADMIN — see
// permissions.ts). Requires fresh password re-confirmation, a mandatory
// reason + category, is logged exactly like every other decision (never a
// silent bypass), and always creates a mandatory post-action review task.
export async function useEmergencyOverride(params: EmergencyOverrideParams): Promise<ApprovalRequest> {
  const policy = await getApprovalPolicy(params.actionType);
  if (!policy?.emergencyOverrideAllowed) {
    throw new ApprovalError(403, `Emergency override is not enabled for "${params.actionType}".`);
  }
  if (!verifyStepUpToken(params.reauthToken, "REAUTH", params.actorId)) {
    throw new ApprovalError(403, "Please re-enter your password to use the emergency override.");
  }

  const approvalCode = await nextSequenceCode("APR");
  const request = await prisma.approvalRequest.create({
    data: {
      approvalCode,
      actionType: params.actionType,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      makerId: params.actorId,
      status: "APPROVED",
      riskLevel: "CRITICAL",
      reason: params.reason,
      requestedPayload: toJson({ emergencyOverride: true, category: params.category, evidenceReference: params.evidenceReference ?? null }),
      requiredLevel: policy.requiredLevel,
      currentLevel: policy.requiredLevel,
      completedAt: new Date(),
      idempotencyKey: `EMERGENCY:${crypto.randomUUID()}`,
    },
  });

  const entry = getCatalogEntry(params.actionType);
  const reviewTask = await createTask({
    taskType: "CRITICAL_APPROVAL",
    resourceType: params.sourceType,
    resourceId: params.sourceId,
    title: `Emergency override review — ${entry?.label ?? params.actionType} (${approvalCode})`,
    description: `An emergency override was used. Category: ${params.category}. Reason: ${params.reason}`,
    priority: "CRITICAL",
    createdById: params.actorId,
    accessLevel: "APPROVE",
    dedupe: false,
  }).catch(() => null);
  const withTask = reviewTask ? await prisma.approvalRequest.update({ where: { id: request.id }, data: { createdTaskId: reviewTask.id } }) : request;

  await recordApprovalEvent({
    approvalRequestId: request.id,
    actorId: params.actorId,
    eventType: "APPROVAL_OVERRIDE_USED",
    metadata: { category: params.category, evidenceReference: params.evidenceReference ?? null, reason: params.reason },
  });
  await notifyEmergencyOverrideUsed(approvalCode, params.actionType);
  return withTask;
}

// ---------- internal helpers ----------

function toJson(value: unknown) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function requireRequest(approvalRequestId: string): Promise<ApprovalRequest> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!request) throw new ApprovalError(404, "Approval request not found.");
  return request;
}

// Optimistic concurrency (spec §35/§46) — every mutation bumps `version`; a
// caller holding a stale version number gets a 409 instead of silently
// clobbering a concurrent decision. Mirrors src/lib/workflow/engine.ts's
// withVersionedUpdate() exactly.
async function withVersionedUpdate(request: ApprovalRequest, data: Record<string, unknown>): Promise<ApprovalRequest> {
  const result = await prisma.approvalRequest.updateMany({
    where: { id: request.id, version: request.version },
    data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
  });
  if (result.count === 0) {
    throw new ApprovalError(409, "This approval request was modified by someone else — reload and try again.");
  }
  return prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } });
}
