import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import type { SessionAdmin } from "@/lib/route-guard";

// STEP 28 §38/§39 — the actual merge EXECUTION step that STEP 24's
// planDuplicateMerge() (src/lib/risk/duplicate-cluster-service.ts) deliberately
// leaves manual: "The data merge itself is performed manually by an
// authorised reviewer after approval — this plan does not execute it."
//
// Conservative by design: ONLY CRM-layer rows (notes, tags, lead history,
// follow-ups, CRM/LEAD-resourceType assignments) move to the survivor.
// Proposal/Payment/Document/Subscription/VerificationDocument foreign keys
// are NEVER rewritten here — that remains out of scope, exactly like the
// planning step's own disclosure. The survivor's absorbedProfileIds plus a
// CrmMergeLink row per absorbed profile let staff still find the absorbed
// profile's historical data on the original record.

export interface MergeResult {
  survivorCrmRecordId: string;
  absorbed: Array<{ profileId: string; movedNotes: number; movedTags: number; movedFollowups: number; movedLeadEvents: number }>;
}

export async function executeMerge(clusterId: string, actor: SessionAdmin, reason: string): Promise<MergeResult> {
  const cluster = await prisma.duplicateCluster.findUnique({ where: { id: clusterId }, include: { members: true } });
  if (!cluster) throw new HttpError(404, "Duplicate cluster not found.");
  if (cluster.status !== "CONFIRMED") throw new HttpError(409, "Only a CONFIRMED duplicate cluster can be merged.");

  // Re-verify the DUPLICATE_MERGE approval is actually APPROVED — this
  // function never re-requests approval, only checks it (the plan step
  // already called enforceApprovalGate; this is defense in depth, not a
  // second gate).
  const approval = await prisma.approvalRequest.findFirst({
    where: { actionType: "DUPLICATE_MERGE", sourceType: "PROFILE", requestedPayload: { path: ["clusterId"], equals: clusterId } },
    orderBy: { createdAt: "desc" },
  });
  if (!approval || approval.status !== "APPROVED") {
    throw new HttpError(403, "This merge has not been approved yet — request and obtain approval before executing.");
  }

  const memberIds = cluster.members.map((m) => m.profileId);
  const holds = await prisma.dataHold.findMany({ where: { active: true, profileId: { in: memberIds } } });
  if (holds.length > 0) throw new HttpError(409, "An active legal hold covers a member profile — this merge cannot execute until it's released.");

  // Survivor = whichever member already has (or first gets) the CrmRecord
  // with the most activity; ranking logic mirrors planDuplicateMerge's own
  // "verified first, then oldest" suggestion, applied to CrmRecord existence.
  const crmRecords = await prisma.crmRecord.findMany({ where: { profileId: { in: memberIds } } });
  if (crmRecords.length === 0) throw new HttpError(422, "No CRM record exists yet for any member of this cluster.");
  const survivor = crmRecords[0];
  const absorbedProfileIds = memberIds.filter((id) => id !== survivor.profileId);

  const results: MergeResult["absorbed"] = [];

  for (const absorbedProfileId of absorbedProfileIds) {
    const absorbedRecord = crmRecords.find((r) => r.profileId === absorbedProfileId);
    const counts = { movedNotes: 0, movedTags: 0, movedFollowups: 0, movedLeadEvents: 0 };

    if (absorbedRecord) {
      await prisma.$transaction(async (tx) => {
        const notes = await tx.crmNote.updateMany({ where: { crmRecordId: absorbedRecord.id }, data: { crmRecordId: survivor.id } });
        counts.movedNotes = notes.count;

        const tags = await tx.crmRecordTag.findMany({ where: { crmRecordId: absorbedRecord.id } });
        for (const tag of tags) {
          await tx.crmRecordTag.upsert({ where: { crmRecordId_tagId: { crmRecordId: survivor.id, tagId: tag.tagId } }, update: {}, create: { crmRecordId: survivor.id, tagId: tag.tagId, addedById: tag.addedById } });
        }
        await tx.crmRecordTag.deleteMany({ where: { crmRecordId: absorbedRecord.id } });
        counts.movedTags = tags.length;

        const followUps = await tx.followUp.updateMany({ where: { crmRecordId: absorbedRecord.id }, data: { crmRecordId: survivor.id } });
        counts.movedFollowups = followUps.count;

        if (absorbedRecord.leadId) {
          const leadEvents = await tx.leadEvent.count({ where: { leadId: absorbedRecord.leadId } });
          counts.movedLeadEvents = leadEvents;
        }

        await tx.adminAssignment.updateMany({ where: { resourceType: "CRM_RECORD", resourceId: absorbedRecord.id }, data: { resourceId: survivor.id } });

        await tx.crmRecord.update({ where: { id: survivor.id }, data: { absorbedProfileIds: { push: absorbedProfileId } } });

        await tx.crmMergeLink.create({
          data: {
            survivorCrmRecordId: survivor.id,
            absorbedProfileId,
            clusterId,
            approvalCode: approval.approvalCode,
            movedNotes: counts.movedNotes,
            movedTags: counts.movedTags,
            movedFollowups: counts.movedFollowups,
            movedLeadEvents: counts.movedLeadEvents,
            executedById: actor.id,
          },
        });
      });
    }

    results.push({ profileId: absorbedProfileId, ...counts });
  }

  await prisma.duplicateCluster.update({ where: { id: clusterId }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actor.id } });
  await writeAudit({ action: "CRM_MERGE_EXECUTED", adminId: actor.id, targetProfileId: survivor.profileId, meta: { clusterId, survivorCrmRecordId: survivor.id, absorbedProfileIds, reason } });

  return { survivorCrmRecordId: survivor.id, absorbed: results };
}
