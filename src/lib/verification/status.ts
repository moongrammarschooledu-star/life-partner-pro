import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { notificationService } from "@/lib/notifications";
import { CHECKLIST_KEYS } from "@/lib/verification/checklist-catalog";
import type { VerificationStatus } from "@prisma/client";

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

// Secure notification copy per status (spec §27) — never includes rejection
// reasons, internal notes, or any other sensitive detail; delivery goes
// through the same console-log stub every other notification in this
// project uses (no real email/SMS provider exists anywhere here).
const NOTIFICATION_COPY: Partial<Record<VerificationStatus, string>> = {
  VERIFIED: "Your profile has been verified. You now have a Verified badge.",
  VERIFICATION_REQUIRED: "Action is required on your Life Partner Pro profile. Please log in to My Verification to review what's needed.",
  VERIFICATION_REJECTED: "There is an update on your Life Partner Pro verification. Please log in to My Verification for details.",
  RE_VERIFICATION_REQUIRED: "Your Life Partner Pro profile requires re-verification. Please log in to My Verification to continue.",
};

async function notifyProfile(profileId: string, body: string) {
  const contact = await prisma.contactInfo.findUnique({ where: { profileId } });
  if (!contact) return;
  await notificationService.send({ channel: "EMAIL", to: contact.email, subject: "Life Partner Pro — Verification Update", body });
}

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

  if (NOTIFICATION_COPY[newStatus]) {
    await notifyProfile(profileId, NOTIFICATION_COPY[newStatus]!);
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
  await notifyProfile(profileId, "Your Life Partner Pro profile has been suspended. Please contact support for more information.");
}
