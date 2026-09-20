import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { invalidateSystemControl } from "@/lib/ops/system-control";
import { confirmationPhraseFor } from "@/lib/backup/pure";
import type { RestoreRequest } from "@prisma/client";

// Restore AUTHORIZATION workflow (spec §58). Nothing here overwrites data —
// the destructive step is performed out-of-app with scripts/restore-backup.ts
// by an operator holding the approved request code. This module enforces the
// pre-conditions and leaves a complete audit trail:
//   authenticated + authorized (permission + reauth checked by the route),
//   confirmation phrase typed, backup exists / completed / restore-verified,
//   explicit target described, two-person rule (approver != requester),
//   system moved to RECOVERY while the restore is pending.

export async function requestRestore(params: { backupId: string; reason: string; targetLabel: string; typedConfirmation: string; actorId: string }): Promise<RestoreRequest> {
  const backup = await prisma.backupRun.findUniqueOrThrow({ where: { id: params.backupId } });
  if (backup.type !== "DATABASE") throw new Error("Only database backups can be restored.");
  if (backup.status !== "COMPLETED" || backup.prunedAt) throw new Error("That backup is not available.");
  if (backup.verificationStatus !== "PASSED") throw new Error("A backup must pass restore verification before a restore can be requested.");
  if (params.typedConfirmation.trim() !== confirmationPhraseFor(backup.backupCode)) throw new Error("The confirmation phrase does not match.");
  if (!params.reason.trim() || !params.targetLabel.trim()) throw new Error("A reason and a description of the restore target are required.");

  const open = await prisma.restoreRequest.findFirst({ where: { status: { in: ["PENDING", "APPROVED"] } } });
  if (open) throw new Error("Another restore request is already open. Resolve it first to prevent accidental overwrite.");

  const request = await prisma.restoreRequest.create({
    data: { backupId: backup.id, reason: params.reason.trim(), targetLabel: params.targetLabel.trim(), requestedById: params.actorId },
  });
  await prisma.systemControl.upsert({
    where: { id: 1 },
    update: { operationalState: "RECOVERY", operationalStateReason: `Restore requested from ${backup.backupCode}`, updatedById: params.actorId },
    create: { id: 1, operationalState: "RECOVERY", operationalStateReason: `Restore requested from ${backup.backupCode}`, updatedById: params.actorId },
  });
  invalidateSystemControl();
  await writeAudit({ action: "RESTORE_REQUESTED", adminId: params.actorId, meta: { requestId: request.id, backupCode: backup.backupCode, targetLabel: params.targetLabel } });
  return request;
}

export async function decideRestore(params: { requestId: string; approve: boolean; actorId: string; notes?: string }): Promise<RestoreRequest> {
  const request = await prisma.restoreRequest.findUniqueOrThrow({ where: { id: params.requestId } });
  if (request.status !== "PENDING") throw new Error("Only a pending request can be decided.");
  if (params.approve && request.requestedById === params.actorId) throw new Error("A restore must be approved by a different administrator than the one who requested it.");

  const updated = await prisma.restoreRequest.update({
    where: { id: request.id },
    data: { status: params.approve ? "APPROVED" : "REJECTED", approvedById: params.actorId, decidedAt: new Date(), notes: params.notes ?? null },
  });
  await writeAudit({ action: "RESTORE_TRIGGERED", adminId: params.actorId, meta: { requestId: request.id, decision: params.approve ? "APPROVED" : "REJECTED" } });
  return updated;
}

export async function markRestoreExecuted(params: { requestId: string; actorId: string; notes?: string }): Promise<RestoreRequest> {
  const request = await prisma.restoreRequest.findUniqueOrThrow({ where: { id: params.requestId } });
  if (request.status !== "APPROVED") throw new Error("Only an approved request can be marked executed.");
  const updated = await prisma.restoreRequest.update({ where: { id: request.id }, data: { status: "EXECUTED", executedAt: new Date(), notes: params.notes ?? request.notes } });
  await writeAudit({ action: "RESTORE_TRIGGERED", adminId: params.actorId, meta: { requestId: request.id, decision: "EXECUTED_OUT_OF_APP" } });
  return updated;
}

export async function cancelRestore(params: { requestId: string; actorId: string }): Promise<RestoreRequest> {
  const request = await prisma.restoreRequest.findUniqueOrThrow({ where: { id: params.requestId } });
  if (request.status !== "PENDING" && request.status !== "APPROVED") throw new Error("This request can no longer be cancelled.");
  const updated = await prisma.restoreRequest.update({ where: { id: request.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  await writeAudit({ action: "RESTORE_TRIGGERED", adminId: params.actorId, meta: { requestId: request.id, decision: "CANCELLED" } });
  return updated;
}
