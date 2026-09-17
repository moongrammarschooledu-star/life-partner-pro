import { prisma } from "@/lib/prisma";
import { hasActiveBreakGlass } from "@/lib/privacy/break-glass";
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
// existing contact:reveal permission alone. A legitimate, named tier for
// admin support workflows, not a bypass of the graded system below.
export function resolveAdHocContactAccessLevel(admin: ContactAccessAdmin): ContactAccessLevel {
  return admin.permissions.includes("contact:reveal") ? "ADMIN_ONLY" : "HIDDEN";
}

// Two-profile share, driven by a specific proposal's ContactPermission rows.
export async function resolveProposalContactAccessLevel(proposalId: string, profileAId: string, profileBId: string): Promise<ContactAccessLevel> {
  const permissions = await prisma.contactPermission.findMany({ where: { proposalId } });
  const isApproved = (profileId: string) => permissions.some((p) => p.profileId === profileId && p.approvedAt && !p.revokedAt);
  if (isApproved(profileAId) && isApproved(profileBId)) return "PROPOSAL_APPROVED";
  return "STAFF_AUTHORIZED";
}

export async function assertContactShareAllowed(params: {
  admin: ContactAccessAdmin;
  proposalId?: string;
  profileAId: string;
  profileBId: string;
}): Promise<{ level: ContactAccessLevel; overrideReason?: string }> {
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

  throw new ContactShareDeniedError();
}

export class ContactShareDeniedError extends Error {
  constructor() {
    super("Contact sharing requires an approved proposal, an explicit override with reason, or emergency access.");
    this.name = "ContactShareDeniedError";
  }
}
