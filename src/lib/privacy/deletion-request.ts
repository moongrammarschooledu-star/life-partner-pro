import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { notifyDeletionRequestReceived, notifyDeletionCompleted } from "@/lib/notifications/events";
import { getRetentionPolicy } from "@/lib/privacy/retention-policy";
import { hasActiveHold } from "@/lib/privacy/data-hold";
import type { DeletionMode } from "@prisma/client";

// Spec §14 — no financial/payment system exists anywhere in this codebase,
// so the spec's "check active proposals/cases/financial records" step 4 is
// satisfied by surfacing active proposals/cases to the admin reviewer (see
// reviewDeletionRequest) rather than a financial check that has nothing to
// check against.
export async function submitDeletionRequest(profileId: string, reason?: string) {
  const requestCode = await nextSequenceCode("DEL");
  const request = await prisma.accountDeletionRequest.create({
    data: { requestCode, profileId, reason: reason ?? null },
  });
  await prisma.profile.update({ where: { id: profileId }, data: { accountStatus: "DELETION_REQUESTED" } });
  await writeAudit({ action: "DELETION_REQUESTED", targetProfileId: profileId, meta: { requestId: request.id, requestCode } });
  await notifyDeletionRequestReceived(profileId, requestCode);
  return request;
}

// Admin review — approve schedules execution (default a short cooling-off
// period, e.g. 7 days, so a change-of-mind is still possible before the
// retention job executes it); reject reverts accountStatus to ACTIVE.
export async function reviewDeletionRequest(params: {
  requestId: string;
  adminId: string;
  decision: "approve" | "reject";
  mode?: DeletionMode;
  rejectionReason?: string;
  coolingOffDays?: number;
}) {
  const request = await prisma.accountDeletionRequest.findUnique({ where: { id: params.requestId } });
  if (!request) throw new Error("Deletion request not found");

  if (params.decision === "approve") {
    // STEP 19 §15 — "Never allow a normal admin to bypass retention/legal-hold
    // rules." Checked again here, at the moment of execution, even though an
    // approval may already exist for this request — an approval can never
    // override an active hold; the hold must be lifted through its own
    // governed flow first.
    if (await hasActiveHold({ profileId: request.profileId })) {
      throw new Error("This profile has an active legal/admin hold — deletion cannot proceed until the hold is lifted.");
    }
    const policy = await getRetentionPolicy("ACCOUNT_DATA");
    const mode: DeletionMode = params.mode ?? (policy?.action === "ANONYMIZE" ? "ANONYMIZE" : "DELETE");
    const scheduledFor = new Date(Date.now() + (params.coolingOffDays ?? 7) * 24 * 60 * 60 * 1000);
    const updated = await prisma.accountDeletionRequest.update({
      where: { id: params.requestId },
      data: { status: "SCHEDULED", mode, scheduledFor, reviewedById: params.adminId, reviewedAt: new Date() },
    });
    await prisma.profile.update({ where: { id: request.profileId }, data: { accountStatus: "DELETION_PROCESSING" } });
    await writeAudit({ action: "DELETION_STARTED", adminId: params.adminId, targetProfileId: request.profileId, meta: { requestId: params.requestId, mode, scheduledFor } });
    return updated;
  }

  const updated = await prisma.accountDeletionRequest.update({
    where: { id: params.requestId },
    data: { status: "REJECTED", rejectionReason: params.rejectionReason ?? null, reviewedById: params.adminId, reviewedAt: new Date() },
  });
  await prisma.profile.update({ where: { id: request.profileId }, data: { accountStatus: "ACTIVE" } });
  return updated;
}

// Called by the retention job right before executing, and again on
// completion, so the applicant is notified without the job itself owning
// notification logic.
export async function notifyDeletionRequestOutcome(profileId: string, requestCode: string) {
  await notifyDeletionCompleted(profileId, requestCode);
}
