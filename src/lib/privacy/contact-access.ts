import { prisma } from "@/lib/prisma";
import { hasActiveBreakGlass } from "@/lib/privacy/break-glass";
import { resolveEffectiveConsent } from "@/lib/privacy/consent";
import { logPrivacyAccess } from "@/lib/privacy/access-log";
import type { ContactAccessLevel } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

// Spec §6/§7 — closes the real gap the STEP 12 code comment on
// /api/admin/profiles/[id]/contact/route.ts admitted: ContactPermission's
// per-proposal consent state existed but was never enforced server-side on
// the actual reveal/share endpoint. This resolver is that enforcement.
export interface ContactAccessAdmin {
  id: string;
  permissions: Permission[];
}

// Ad-hoc single-profile lookup (no proposal context) — gated at the
// existing contact:reveal permission, OR the independently-grantable
// sensitive:contact:view permission (STEP 17 §17: a narrower role can be
// given just this sensitive permission without the broader contact:reveal
// grant). A legitimate, named tier for admin support workflows, not a
// bypass of the graded system below.
export function resolveAdHocContactAccessLevel(admin: ContactAccessAdmin): ContactAccessLevel {
  return admin.permissions.includes("contact:reveal") || admin.permissions.includes("sensitive:contact:view") ? "ADMIN_ONLY" : "HIDDEN";
}

// Two-profile share, driven by a specific proposal's ContactPermission rows.
export async function resolveProposalContactAccessLevel(proposalId: string, profileAId: string, profileBId: string): Promise<ContactAccessLevel> {
  const permissions = await prisma.contactPermission.findMany({ where: { proposalId } });
  const isApproved = (profileId: string) => permissions.some((p) => p.profileId === profileId && p.approvedAt && !p.revokedAt);
  if (isApproved(profileAId) && isApproved(profileBId)) return "PROPOSAL_APPROVED";
  return "STAFF_AUTHORIZED";
}

async function denyAndLog(params: { admin: ContactAccessAdmin; profileAId: string; profileBId: string; reason: string }): Promise<never> {
  await logPrivacyAccess({
    actorAdminId: params.admin.id,
    action: "CONTACT_SHARE_DENIED",
    field: "mobileNumber",
    targetProfileId: params.profileAId,
    reason: params.reason,
  });
  throw new ContactShareDeniedError(params.reason);
}

export async function assertContactShareAllowed(params: {
  admin: ContactAccessAdmin;
  proposalId?: string;
  profileAId: string;
  profileBId: string;
}): Promise<{ level: ContactAccessLevel; overrideReason?: string }> {
  // Spec §18 step — either profile explicitly revoking CONTACT_SHARING
  // consent is a hard stop, even ahead of an otherwise-approved proposal.
  // Absence of a consent row is treated as granted (backfill default —
  // src/lib/privacy/consent-backfill.ts), so only an explicit REVOKED blocks.
  const [consentA, consentB] = await Promise.all([
    resolveEffectiveConsent(params.profileAId),
    resolveEffectiveConsent(params.profileBId),
  ]);
  if (consentA.CONTACT_SHARING === "REVOKED" || consentB.CONTACT_SHARING === "REVOKED") {
    return denyAndLog({ ...params, reason: "One of these profiles has revoked contact-sharing consent." });
  }

  if (params.proposalId) {
    const level = await resolveProposalContactAccessLevel(params.proposalId, params.profileAId, params.profileBId);
    if (level === "PROPOSAL_APPROVED") return { level };
  }

  // No approved proposal — allow only with an explicit override permission
  // (a genuine "Family Contact Approved" workflow outside the proposal
  // flow), or a scoped, audited, time-limited break-glass grant.
  if (params.admin.permissions.includes("contact:reveal:override")) {
    return { level: "FAMILY_CONTACT_APPROVED" };
  }

  if (await hasActiveBreakGlass(params.admin.id, "CONTACT", `${params.profileAId}:${params.profileBId}`)) {
    return { level: "USER_APPROVED" };
  }

  return denyAndLog({ ...params, reason: "No approved proposal, override permission, or emergency access." });
}

export class ContactShareDeniedError extends Error {
  constructor(message = "Contact sharing requires an approved proposal, an explicit override with reason, or emergency access.") {
    super(message);
    this.name = "ContactShareDeniedError";
  }
}
