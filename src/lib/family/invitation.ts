import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import { generateEmailToken, isExpired, expiresInMinutes } from "@/lib/verification/otp";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { emailProvider } from "@/lib/notifications/providers/email-provider";
import { FAMILY_ROLE_PERMISSIONS } from "@/lib/family/permissions";
import { grantFamilyPermission } from "@/lib/family/grants";
import { notifyFamilyInvitationAccepted } from "@/lib/notifications/events";
import type { FamilyRole } from "@prisma/client";

export class FamilyInvitationError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "FamilyInvitationError";
  }
}

const INVITATION_TTL_MINUTES = 7 * 24 * 60; // 7 days
const TOKEN_HASH_ROUNDS = 10; // matches the OTP module's convention for short-lived, high-entropy tokens

async function getOrCreateFamilyAccount(applicantId: string) {
  const existing = await prisma.familyAccount.findUnique({ where: { applicantId } });
  if (existing) return existing;
  const familyCode = await nextSequenceCode("FAM");
  return prisma.familyAccount.create({ data: { familyCode, applicantId } });
}

// Returns the raw token ONLY here — the caller (the /api/my-family/invitations
// route) builds the invite link and sends it; never stored, logged, or
// returned again after this call (spec §4 — never a predictable token, never
// placed in a way that gets persisted in plaintext).
export async function createInvitation(params: {
  applicantId: string;
  invitedName: string;
  invitedEmail?: string;
  invitedMobile?: string;
  relationship: string;
  requestedRole?: FamilyRole;
}): Promise<{ invitationCode: string; rawToken: string; expiresAt: Date }> {
  if (!params.invitedEmail && !params.invitedMobile) {
    throw new FamilyInvitationError(400, "An email or mobile number is required to invite a family member.");
  }

  const familyAccount = await getOrCreateFamilyAccount(params.applicantId);
  const invitationCode = await nextSequenceCode("FAM");
  const rawToken = generateEmailToken();
  const tokenHash = await bcrypt.hash(rawToken, TOKEN_HASH_ROUNDS);
  const expiresAt = expiresInMinutes(INVITATION_TTL_MINUTES);

  await prisma.familyInvitation.create({
    data: {
      invitationCode,
      familyAccountId: familyAccount.id,
      invitedName: params.invitedName,
      invitedEmail: params.invitedEmail ?? null,
      invitedMobile: params.invitedMobile ?? null,
      relationship: params.relationship,
      requestedRole: params.requestedRole ?? "FAMILY_VIEWER",
      tokenHash,
      expiresAt,
      status: "SENT",
    },
  });

  await writeAudit({ action: "FAMILY_INVITATION_CREATED", targetProfileId: params.applicantId, meta: { invitationCode, relationship: params.relationship } });

  if (params.invitedEmail) {
    const link = `${process.env.NEXTAUTH_URL ?? ""}/family/register?code=${invitationCode}&token=${rawToken}`;
    await emailProvider.send(
      params.invitedEmail,
      `You have been invited to assist with a matrimonial process on Life Partner Pro. This link is valid for 7 days and can only be used once: ${link}`,
      "You've Been Invited on Life Partner Pro"
    ).catch((err) => console.error("[family-invitation] email send failed", err));
  }

  return { invitationCode, rawToken, expiresAt };
}

// Invalidates the old token — a fresh random token/hash/expiry is issued.
export async function resendInvitation(invitationId: string, applicantId: string): Promise<{ invitationCode: string; rawToken: string }> {
  const invitation = await prisma.familyInvitation.findFirst({ where: { id: invitationId, familyAccount: { applicantId } } });
  if (!invitation) throw new FamilyInvitationError(404, "Invitation not found.");
  if (invitation.status === "ACCEPTED" || invitation.status === "REVOKED") {
    throw new FamilyInvitationError(400, `Cannot resend an invitation that is already ${invitation.status.toLowerCase()}.`);
  }

  const rawToken = generateEmailToken();
  const tokenHash = await bcrypt.hash(rawToken, TOKEN_HASH_ROUNDS);
  const expiresAt = expiresInMinutes(INVITATION_TTL_MINUTES);

  await prisma.familyInvitation.update({
    where: { id: invitationId },
    data: { tokenHash, expiresAt, status: "SENT" },
  });
  await writeAudit({ action: "FAMILY_INVITATION_RESENT", targetProfileId: applicantId, meta: { invitationCode: invitation.invitationCode } });

  if (invitation.invitedEmail) {
    const link = `${process.env.NEXTAUTH_URL ?? ""}/family/register?code=${invitation.invitationCode}&token=${rawToken}`;
    await emailProvider.send(
      invitation.invitedEmail,
      `Here is your new invitation link to Life Partner Pro. This link is valid for 7 days and can only be used once: ${link}`,
      "Your Life Partner Pro Invitation Link"
    ).catch((err) => console.error("[family-invitation] resend email failed", err));
  }

  return { invitationCode: invitation.invitationCode, rawToken };
}

export async function revokeInvitation(invitationId: string, applicantId: string): Promise<void> {
  const result = await prisma.familyInvitation.updateMany({
    where: { id: invitationId, familyAccount: { applicantId }, status: { notIn: ["ACCEPTED", "REVOKED"] } },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  if (result.count === 0) throw new FamilyInvitationError(404, "Invitation not found or already accepted/revoked.");
  await writeAudit({ action: "FAMILY_INVITATION_REVOKED", targetProfileId: applicantId, meta: { invitationId } });
}

// The invitee clicking the emailed link and setting a password. Email
// verification is satisfied by this flow itself (only someone who received
// and opened the emailed link can reach this point) — no separate OTP
// sub-system for family members in this pass (disclosed simplification;
// mobile-only invitations are accepted without a verified channel until a
// follow-up step adds one).
export async function acceptInvitation(params: { invitationCode: string; token: string; password: string }): Promise<{ familyMemberId: string }> {
  const invitation = await prisma.familyInvitation.findUnique({ where: { invitationCode: params.invitationCode } });
  if (!invitation) throw new FamilyInvitationError(404, "Invitation not found.");
  if (invitation.status === "ACCEPTED") throw new FamilyInvitationError(409, "This invitation has already been used.");
  if (invitation.status === "REVOKED" || invitation.status === "SUSPENDED") throw new FamilyInvitationError(410, "This invitation is no longer valid.");
  if (isExpired(invitation.expiresAt)) {
    await prisma.familyInvitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
    throw new FamilyInvitationError(410, "This invitation has expired. Please ask for a new one.");
  }

  const tokenMatches = await bcrypt.compare(params.token, invitation.tokenHash);
  if (!tokenMatches) throw new FamilyInvitationError(401, "Invalid invitation link.");

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const minLength = settings?.passwordMinLength ?? 8;
  if (params.password.length < minLength) throw new FamilyInvitationError(400, `Password must be at least ${minLength} characters.`);

  const familyAccount = await prisma.familyAccount.findUnique({ where: { id: invitation.familyAccountId } });
  if (!familyAccount) throw new FamilyInvitationError(404, "Family account not found.");

  const passwordHash = await bcrypt.hash(params.password, 12);

  // "Create or connect" (spec §5) — reactivate a previously removed/revoked
  // member with the same email on this family account instead of a duplicate.
  const existing = invitation.invitedEmail
    ? await prisma.familyMember.findFirst({ where: { familyAccountId: familyAccount.id, email: invitation.invitedEmail } })
    : null;

  const member = existing
    ? await prisma.familyMember.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: invitation.requestedRole,
          status: "ACTIVE",
          emailVerified: !!invitation.invitedEmail,
          joinedAt: new Date(),
          suspendedAt: null,
          suspendedReason: null,
          removedAt: null,
        },
      })
    : await prisma.familyMember.create({
        data: {
          familyAccountId: familyAccount.id,
          fullName: invitation.invitedName,
          relationship: invitation.relationship,
          email: invitation.invitedEmail,
          mobile: invitation.invitedMobile,
          emailVerified: !!invitation.invitedEmail,
          passwordHash,
          role: invitation.requestedRole,
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      });

  await prisma.familyInvitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date(), familyMemberId: member.id } });

  await prisma.familyConsent.create({
    data: { familyMemberId: member.id, applicantId: familyAccount.applicantId, consentType: "FAMILY_INVITATION", version: "1.0", status: "GRANTED" },
  });

  // Apply the default permission set for the requested role (Decision 4) —
  // sensitive ones go PENDING_APPROVAL via grantFamilyPermission's own logic.
  const defaults = FAMILY_ROLE_PERMISSIONS[invitation.requestedRole] ?? [];
  for (const permission of defaults) {
    await grantFamilyPermission({ familyMemberId: member.id, permission, grantedByProfileId: familyAccount.applicantId });
  }

  await writeAudit({ action: "FAMILY_INVITATION_ACCEPTED", targetProfileId: familyAccount.applicantId, actorFamilyMemberId: member.id, meta: { invitationCode: invitation.invitationCode } });
  await writeAudit({ action: "FAMILY_MEMBER_ADDED", targetProfileId: familyAccount.applicantId, actorFamilyMemberId: member.id });
  await notifyFamilyInvitationAccepted(familyAccount.applicantId, member.fullName);

  return { familyMemberId: member.id };
}
