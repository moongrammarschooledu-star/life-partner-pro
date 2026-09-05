import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notifyProfileVerificationChanged, notifyProfileSuspended } from "@/lib/notifications/events";
import { CHECKLIST_KEYS } from "@/lib/verification/checklist-catalog";
import { computeProfileCompleteness } from "@/lib/verification/completeness";
import type { VerificationStatus } from "@prisma/client";

// Profile.profileCompletion is set once at registration and otherwise
// never recomputed — without this, verifying phone/email (which counts
// toward the Contact category) would silently leave the stored value stale
// while /my-verification and the admin review page (which both compute
// fresh) show a higher, correct number. Called after any event that can
// change the canonical inputs (currently: phone/email verification).
export async function recomputeStoredCompleteness(profileId: string): Promise<void> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: { contact: true, education: true, profession: true, family: true, lifestyle: true, preference: true, photos: { select: { id: true } }, verification: true },
  });
  if (!profile) return;

  const { percent } = computeProfileCompleteness({
    fullName: profile.fullName,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    maritalStatus: profile.maritalStatus,
    heightCm: profile.heightCm,
    city: profile.city,
    country: profile.country,
    nationality: profile.nationality,
    area: profile.area,
    contact: profile.contact,
    phoneVerified: !!profile.verification?.phoneVerifiedAt,
    emailVerified: !!profile.verification?.emailVerifiedAt,
    education: profile.education,
    profession: profile.profession,
    family: profile.family,
    lifestyle: profile.lifestyle,
    preference: profile.preference,
    hasPhoto: profile.photos.length > 0,
  });

  await prisma.profile.update({ where: { id: profileId }, data: { profileCompletion: percent } });
}

// Profiles registered before STEP 8 have no ProfileVerification row at all
// (registration only started creating one going forward) — without this,
// the Verification Center's queue/KPIs would silently show zero for every
// pre-existing profile despite them being real, some already verified via
// the old one-click action. Called from the dashboard route so the queue is
// always complete; cheap no-op once every profile has a row.
export async function ensureAllProfileVerifications(): Promise<void> {
  const missing = await prisma.profile.findMany({
    where: { verification: null, softDeleted: false },
    select: { id: true, verified: true },
  });
  if (missing.length === 0) return;

  await prisma.$transaction(
    missing.map((p) =>
      prisma.profileVerification.create({
        data: {
          profileId: p.id,
          // Reflect the existing verified boolean rather than defaulting
          // everyone to NOT_VERIFIED — an admin already verified some of
          // these under the old system, and the new status display must
          // not silently "unverify" them.
          status: p.verified ? "VERIFIED" : "VERIFICATION_PENDING",
          items: { create: CHECKLIST_KEYS.map((itemKey) => ({ itemKey })) },
        },
      })
    )
  );
}

// STEP 9 notification type per verification status — routed through the
// central notification service (src/lib/notifications/notification-service.ts)
// so in-app/email/SMS/WhatsApp all get consistent, admin-editable, EN/UR
// copy instead of a single hardcoded English email string.
const NOTIFICATION_TYPE_FOR_STATUS: Partial<
  Record<VerificationStatus, Parameters<typeof notifyProfileVerificationChanged>[1]>
> = {
  VERIFIED: "VERIFICATION_APPROVED",
  VERIFICATION_REQUIRED: "VERIFICATION_ACTION_REQUIRED",
  VERIFICATION_REJECTED: "VERIFICATION_REJECTED",
  RE_VERIFICATION_REQUIRED: "RE_VERIFICATION_REQUIRED",
};

interface SetStatusOptions {
  adminId: string;
  note?: string;
  rejectionReasonCategory?: string;
  rejectionNote?: string;
  reVerificationReason?: string;
  requestedInfoItems?: string[];
}

// Central transition point for ProfileVerification.status — every admin
// action and self-service OTP/email confirmation routes through this so
// Profile.verified (read unchanged everywhere else in the app: matching,
// proposals, badges) always stays in sync with the richer verification
// record. Never call prisma.profileVerification.update() directly.
export async function setVerificationStatus(profileId: string, newStatus: VerificationStatus, opts: SetStatusOptions) {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const removeFromPoolDuringReVerification = settings?.removeFromPoolDuringReVerification ?? true;

  const existing = await prisma.profileVerification.findUnique({ where: { profileId } });
  const currentVerified = (await prisma.profile.findUnique({ where: { id: profileId }, select: { verified: true } }))?.verified ?? false;

  // A blind `verified = (status === "VERIFIED")` mapping is wrong for
  // RE_VERIFICATION_REQUIRED specifically — spec §18 makes "does this pull a
  // profile out of the pool" a configurable policy, not an automatic side
  // effect of every re-verification request.
  const nextVerified =
    newStatus === "VERIFIED"
      ? true
      : newStatus === "RE_VERIFICATION_REQUIRED"
        ? removeFromPoolDuringReVerification
          ? false
          : currentVerified
        : false;

  const data: Record<string, unknown> = {
    status: newStatus,
    lastReviewedAt: new Date(),
    lastReviewedById: opts.adminId,
  };
  if (newStatus === "VERIFICATION_REJECTED") {
    data.rejectionReasonCategory = opts.rejectionReasonCategory ?? null;
    data.rejectionNote = opts.rejectionNote ?? null;
  }
  if (newStatus === "RE_VERIFICATION_REQUIRED") {
    data.reVerificationReason = opts.reVerificationReason ?? null;
  }
  if (newStatus === "VERIFICATION_REQUIRED") {
    data.requestedInfoItems = opts.requestedInfoItems ? JSON.stringify(opts.requestedInfoItems) : null;
  }
  if (newStatus === "VERIFIED") {
    // Clear any stale rejection/re-verification context once approved.
    data.rejectionReasonCategory = null;
    data.rejectionNote = null;
    data.reVerificationReason = null;
    data.requestedInfoItems = null;
  }

  const [verification] = await prisma.$transaction([
    existing
      ? prisma.profileVerification.update({ where: { profileId }, data })
      : prisma.profileVerification.create({ data: { profileId, ...data } as never }),
    prisma.profile.update({ where: { id: profileId }, data: { verified: nextVerified } }),
  ]);

  if (opts.note && opts.note.trim()) {
    await prisma.profileNote.create({ data: { profileId, adminId: opts.adminId, text: opts.note.trim() } });
  }

  await writeAudit({
    action: "VERIFICATION_STATUS_CHANGED",
    adminId: opts.adminId,
    targetProfileId: profileId,
    meta: { status: newStatus },
  });

  const notifyType = NOTIFICATION_TYPE_FOR_STATUS[newStatus];
  if (notifyType) {
    await notifyProfileVerificationChanged(profileId, notifyType);
  }

  return verification;
}

// Suspend is a Profile-level lifecycle action (spec §14), not one of the 8
// VerificationStatus values — a suspended profile is also treated as
// unverified for matching purposes regardless of its prior status.
export async function suspendProfile(profileId: string, opts: { adminId: string; reason?: string }) {
  await prisma.$transaction([
    prisma.profile.update({ where: { id: profileId }, data: { status: "SUSPENDED", verified: false } }),
    prisma.profileVerification.upsert({
      where: { profileId },
      update: { suspensionReason: opts.reason ?? null, lastReviewedAt: new Date(), lastReviewedById: opts.adminId },
      create: { profileId, status: "NOT_VERIFIED", suspensionReason: opts.reason ?? null, lastReviewedAt: new Date(), lastReviewedById: opts.adminId },
    }),
  ]);

  if (opts.reason && opts.reason.trim()) {
    await prisma.profileNote.create({ data: { profileId, adminId: opts.adminId, text: `Suspended: ${opts.reason.trim()}` } });
  }

  await writeAudit({ action: "PROFILE_SUSPENDED", adminId: opts.adminId, targetProfileId: profileId, meta: { reason: opts.reason } });
  await notifyProfileSuspended(profileId);
}
