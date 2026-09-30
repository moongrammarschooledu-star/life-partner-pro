import { prisma } from "@/lib/prisma";
import { validateTransition } from "@/lib/crm/lifecycle-service";
import type { ProfileStatus, CrmLifecycleStage } from "@prisma/client";

// STEP 28 §1 (disclosed decision) — ProfileStatus stays the sole driver of
// matching/proposal/verification logic; this is the ONE-WAY hook the other
// direction. Called AFTER an existing Profile.status write already
// succeeded (verification approval, proposal finalize, etc.) — additive,
// never blocking, never throwing (same never-throw convention as
// sendNotification), and CrmLifecycleStage is never written back to Profile.
const PROFILE_STATUS_TO_SUGGESTED_STAGE: Partial<Record<ProfileStatus, CrmLifecycleStage>> = {
  VERIFIED: "VERIFIED",
  ACTIVE: "ACTIVE",
  MATCHING: "MATCHING",
  MARRIED: "MARRIED",
  SUSPENDED: "SUSPENDED",
  ARCHIVED: "ARCHIVED",
  REJECTED: "REJECTED",
};

export async function syncCrmStageFromProfileStatus(profileId: string, newStatus: ProfileStatus): Promise<void> {
  try {
    const suggested = PROFILE_STATUS_TO_SUGGESTED_STAGE[newStatus];
    if (!suggested) return;

    const record = await prisma.crmRecord.findUnique({ where: { profileId } });
    if (!record) return; // no CRM record yet — nothing to sync (e.g. pre-STEP-28 profiles)
    if (record.lifecycleStage === suggested) return;

    // Writes directly (not via transitionStage) because automation must
    // silently no-op on anything the guard would reject, never throw.
    if (!validateTransition(record.lifecycleStage, suggested)) return;

    await prisma.$transaction([
      recordLifecycleEventTx(record.id, record.lifecycleStage, suggested),
      prisma.crmRecord.update({ where: { id: record.id }, data: { lifecycleStage: suggested, lastActivityAt: new Date() } }),
    ]);
  } catch {
    // Never let a CRM sync failure affect the caller's real Profile.status write.
  }
}

function recordLifecycleEventTx(crmRecordId: string, fromStage: CrmLifecycleStage, toStage: CrmLifecycleStage) {
  return prisma.crmLifecycleHistory.create({ data: { crmRecordId, fromStage, toStage, triggeredBy: "PROFILE_STATUS_SYNC" } });
}

// Profile.verified is a separate boolean (see src/lib/verification/status.ts's
// setVerificationStatus — it does NOT write Profile.status), so "an applicant
// just got verified" needs its own sync entry point alongside
// syncCrmStageFromProfileStatus above.
export async function syncCrmStageOnVerification(profileId: string): Promise<void> {
  try {
    const record = await prisma.crmRecord.findUnique({ where: { profileId } });
    if (!record || record.lifecycleStage === "VERIFIED") return;
    if (!validateTransition(record.lifecycleStage, "VERIFIED")) return;
    await prisma.$transaction([
      recordLifecycleEventTx(record.id, record.lifecycleStage, "VERIFIED"),
      prisma.crmRecord.update({ where: { id: record.id }, data: { lifecycleStage: "VERIFIED", lastActivityAt: new Date() } }),
    ]);
  } catch {
    // never affect the caller's real verification write
  }
}
