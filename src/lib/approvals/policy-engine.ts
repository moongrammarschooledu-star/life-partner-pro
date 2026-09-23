import { prisma } from "@/lib/prisma";
import { getCatalogEntry } from "@/lib/approvals/catalog";
import { DECIDABLE_APPROVAL_STATUSES } from "@/lib/approvals/status";
import type { ApprovalPolicy, ApprovalRequest, ApprovalRiskLevel, ApprovalLevel, AdminRole } from "@prisma/client";

// STEP 19 §8 — ApprovalPolicyEngine. Implemented as plain exported functions
// (not a class) to match src/lib/workflow/engine.ts's own convention. This
// module is pure decision logic: it reads ApprovalPolicy/ApprovalRequest/
// ApprovalReviewer rows and answers questions; it never mutates a request
// itself (that's src/lib/approvals/engine.ts, which imports and calls into
// this module — never the other way around, so there is no circular
// dependency). The spec's 11th method, executeApprovedAction(), is
// implemented in engine.ts as markApprovalExecuted()/markApprovalExecutionFailed()
// instead — genuine execution is a state mutation, not a policy decision;
// see the STEP 19 plan's architecture decision 2 for why gate.ts, not this
// module, is what actually runs a domain's mutation.

export interface ApprovalContext {
  amountMinor?: number;
  currencyCode?: string;
  departmentId?: string | null;
  [key: string]: unknown;
}

// ---------- getApprovalPolicy / requiresApproval / calculateRisk / getRequiredApprovers ----------

export async function getApprovalPolicy(actionType: string): Promise<ApprovalPolicy | null> {
  return prisma.approvalPolicy.findUnique({ where: { actionType } });
}

// A financial action's *required level* can escalate past its policy's base
// requiredLevel when the amount crosses a configured threshold tier (spec
// §10) — never hardcoded, always read from ApprovalAmountThreshold.
async function resolveAmountTier(actionType: string, amountMinor: number, currencyCode: string) {
  return prisma.approvalAmountThreshold.findFirst({
    where: {
      actionType,
      currencyCode,
      minAmountMinor: { lte: amountMinor },
      OR: [{ maxAmountMinor: null }, { maxAmountMinor: { gte: amountMinor } }],
    },
    orderBy: { minAmountMinor: "desc" },
  });
}

export async function requiresApproval(actionType: string, context: ApprovalContext = {}): Promise<boolean> {
  const policy = await getApprovalPolicy(actionType);
  if (!policy || !policy.enabled) return false;
  if (policy.requiredLevel !== "LEVEL_0") return true;

  // Spec §10 — even a policy defaulted to LEVEL_0 ("no approval required")
  // must still require approval once a configured financial threshold is
  // crossed (e.g. a normally-routine action becomes high-risk above a
  // certain amount).
  if (context.amountMinor != null && context.currencyCode) {
    const tier = await resolveAmountTier(actionType, context.amountMinor, context.currencyCode);
    if (tier && tier.requiredLevel !== "LEVEL_0") return true;
  }
  return false;
}

export async function calculateRisk(actionType: string, context: ApprovalContext = {}): Promise<ApprovalRiskLevel> {
  const policy = await getApprovalPolicy(actionType);
  const base = policy?.riskLevel ?? getCatalogEntry(actionType)?.defaultRiskLevel ?? "MEDIUM";
  if (context.amountMinor != null && context.currencyCode) {
    const tier = await resolveAmountTier(actionType, context.amountMinor, context.currencyCode);
    if (tier && RISK_RANK[levelToRisk(tier.requiredLevel)] > RISK_RANK[base]) {
      return levelToRisk(tier.requiredLevel);
    }
  }
  return base;
}

const RISK_RANK: Record<ApprovalRiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const LEVEL_RANK: Record<ApprovalLevel, number> = { LEVEL_0: 0, LEVEL_1: 1, LEVEL_2: 2, LEVEL_3: 3, LEVEL_4: 4, LEVEL_5: 5 };
// Coarse level->risk mapping used only to compare an amount-threshold tier's
// requiredLevel against the policy's own base risk — never persisted.
function levelToRisk(level: ApprovalLevel): ApprovalRiskLevel {
  if (LEVEL_RANK[level] >= 4) return "CRITICAL";
  if (LEVEL_RANK[level] >= 3) return "HIGH";
  if (LEVEL_RANK[level] >= 2) return "MEDIUM";
  return "LOW";
}

export interface RequiredApprovers {
  requiredLevel: ApprovalLevel;
  minimumApprovers: number;
  quorum: number;
  allowedRoles: AdminRole[];
}

export async function getRequiredApprovers(actionType: string, context: ApprovalContext = {}): Promise<RequiredApprovers> {
  const policy = await getApprovalPolicy(actionType);
  if (!policy) {
    const entry = getCatalogEntry(actionType);
    return { requiredLevel: entry?.defaultRequiredLevel ?? "LEVEL_1", minimumApprovers: 1, quorum: 1, allowedRoles: entry?.defaultAllowedRoles ?? [] };
  }
  let requiredLevel = policy.requiredLevel;
  let minimumApprovers = policy.minimumApprovers;
  let quorum = policy.quorum;
  if (context.amountMinor != null && context.currencyCode) {
    const tier = await resolveAmountTier(actionType, context.amountMinor, context.currencyCode);
    if (tier && LEVEL_RANK[tier.requiredLevel] > LEVEL_RANK[requiredLevel]) {
      requiredLevel = tier.requiredLevel;
      minimumApprovers = Math.max(minimumApprovers, tier.minimumApprovers);
      quorum = Math.max(quorum, tier.minimumApprovers);
    }
  }
  return { requiredLevel, minimumApprovers, quorum, allowedRoles: policy.allowedRoles };
}

// ---------- validateApprover / canApprove / canReject / canRequestChanges ----------

interface ActorStanding {
  id: string;
  role: AdminRole;
  active: boolean;
}

async function loadActor(userId: string): Promise<ActorStanding | null> {
  const admin = await prisma.adminUser.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
  return admin;
}

// The single unconditional rule (spec §1/§5): a maker can NEVER approve
// their own request, regardless of role, permission, or policy — this check
// runs before any role/eligibility check and cannot be configured away.
function isSelfApproval(request: ApprovalRequest, actorId: string): boolean {
  return request.makerId === actorId;
}

// True only when the actor currently holds a role this request's policy
// allows AND is still an active admin — re-checked live on every call so a
// disabled account or a since-changed role never counts (spec §28).
export async function validateApprover(userId: string, approvalRequestId: string): Promise<boolean> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!request) return false;
  if (isSelfApproval(request, userId)) return false;

  const actor = await loadActor(userId);
  if (!actor || !actor.active) return false;

  const { allowedRoles } = await getRequiredApprovers(request.actionType);
  if (allowedRoles.length === 0 || allowedRoles.includes(actor.role)) return true;

  // Not directly eligible by role — check for an active delegation (spec
  // §27) that makes this actor stand in for an eligible delegator. The
  // delegate never gains new permissions/role; they are simply treated as
  // eligible for this one decision, scoped by time window and actionType.
  return hasActiveDelegationFor(userId, request);
}

async function hasActiveDelegationFor(delegateId: string, request: ApprovalRequest): Promise<boolean> {
  const now = new Date();
  const delegations = await prisma.approvalDelegation.findMany({
    where: { delegateId, status: "ACTIVE", startAt: { lte: now }, endAt: { gte: now } },
    include: { delegator: { select: { id: true, role: true, active: true } } },
  });
  if (delegations.length === 0) return false;

  const { allowedRoles } = await getRequiredApprovers(request.actionType);
  for (const delegation of delegations) {
    if (delegation.allowedActionTypes.length > 0 && !delegation.allowedActionTypes.includes(request.actionType)) continue;
    if (!delegation.delegator.active) continue;
    if (delegation.delegatorId === request.makerId) continue; // never launder a self-approval through delegation
    if (allowedRoles.length > 0 && !allowedRoles.includes(delegation.delegator.role)) continue;
    return true;
  }
  return false;
}

export async function canApprove(userId: string, approvalRequestId: string): Promise<boolean> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!request) return false;
  if (!DECIDABLE_APPROVAL_STATUSES.includes(request.status)) return false;
  if (await isExpired(approvalRequestId)) return false;
  return validateApprover(userId, approvalRequestId);
}

export async function canReject(userId: string, approvalRequestId: string): Promise<boolean> {
  // Rejection uses the same eligibility rule as approval (spec doesn't carve
  // out a separate reviewer pool for "no") — still never the maker, still
  // must hold an allowed role, still not on an expired/terminal request.
  return canApprove(userId, approvalRequestId);
}

export async function canRequestChanges(userId: string, approvalRequestId: string): Promise<boolean> {
  return canApprove(userId, approvalRequestId);
}

// ---------- checkQuorum ----------

export interface QuorumResult {
  satisfied: boolean;
  approvedCount: number;
  requiredCount: number;
  stepId: string | null;
}

// Excludes (spec §28): duplicate approvals (the DB's @@unique([stepId,
// reviewerId]) already makes a "second" approval from the same reviewer an
// update, not a new row), the maker's own decision (can never exist — see
// isSelfApproval, enforced before a decision is ever recorded), a revoked/
// deactivated user's decision (re-checked live via AdminUser.active), an
// expired request's decisions (checked by the caller via isExpired before
// this is even consulted), and a reviewer whose CURRENT role is no longer in
// the policy's allowedRoles (re-checked live, not the stored roleAtDecision).
export async function checkQuorum(approvalRequestId: string): Promise<QuorumResult> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId } });
  if (!request) return { satisfied: false, approvedCount: 0, requiredCount: 1, stepId: null };

  const step = await prisma.approvalStep.findFirst({
    where: { approvalRequestId, level: request.currentLevel },
    orderBy: { sequence: "asc" },
    include: { reviewers: { include: { reviewer: { select: { id: true, role: true, active: true } } } } },
  });
  if (!step) return { satisfied: false, approvedCount: 0, requiredCount: 1, stepId: null };

  const { allowedRoles } = await getRequiredApprovers(request.actionType);
  const eligibleRoles = step.requiredRoles.length > 0 ? step.requiredRoles : allowedRoles;

  const validApprovals = step.reviewers.filter((r) => {
    if (r.decision !== "APPROVED") return false;
    if (r.reviewerId === request.makerId) return false; // belt-and-braces; should never occur
    if (!r.reviewer.active) return false;
    if (eligibleRoles.length > 0 && !eligibleRoles.includes(r.reviewer.role)) return false;
    return true;
  });

  return { satisfied: validApprovals.length >= step.quorumCount, approvedCount: validApprovals.length, requiredCount: step.quorumCount, stepId: step.id };
}

// ---------- isExpired ----------

export async function isExpired(approvalRequestId: string): Promise<boolean> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: approvalRequestId }, select: { expiresAt: true, status: true } });
  if (!request?.expiresAt) return false;
  if (request.status === "EXECUTED" || request.status === "CANCELLED" || request.status === "ARCHIVED") return false;
  return request.expiresAt.getTime() < Date.now();
}
