import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { revokeAllFamilyMemberSessions } from "@/lib/family/family-member-session";
import type { FamilyRole, FamilySharedRecordType } from "@prisma/client";

// FamilyAccessControlService (STEP 22 plan Decision 5) — the single choke
// point every family-facing route must call before touching data. Plain
// exported functions, not a class (matching this codebase's convention).
// Every check defaults to DENY: a lookup that can't resolve cleanly (missing
// row, expired, wrong family) returns false/null, never throws past that
// into an "allow" path.

export function isAccessExpired(row: { expiresAt: Date | null }, now: Date = new Date()): boolean {
  return !!row.expiresAt && row.expiresAt.getTime() < now.getTime();
}

export interface FamilyMembership {
  familyMemberId: string;
  applicantId: string;
  role: FamilyRole;
  status: string;
}

// Loads the member + resolves their applicant's profileId — the ONE place
// that maps a family session to "which applicant does this belong to."
// Routes should always derive applicantId from here, never accept it as a
// client-supplied parameter (structurally prevents cross-family access).
export async function getFamilyMembership(familyMemberId: string): Promise<FamilyMembership | null> {
  const member = await prisma.familyMember.findUnique({
    where: { id: familyMemberId },
    select: { id: true, role: true, status: true, familyAccount: { select: { applicantId: true, status: true } } },
  });
  if (!member || member.status !== "ACTIVE" || member.familyAccount.status !== "ACTIVE") return null;
  return { familyMemberId: member.id, applicantId: member.familyAccount.applicantId, role: member.role, status: member.status };
}

export async function isFamilyMember(familyMemberId: string): Promise<boolean> {
  return (await getFamilyMembership(familyMemberId)) !== null;
}

export async function getFamilyRole(familyMemberId: string): Promise<FamilyRole | null> {
  return (await getFamilyMembership(familyMemberId))?.role ?? null;
}

export async function getFamilyPermissions(familyMemberId: string) {
  const rows = await prisma.familyPermission.findMany({ where: { familyMemberId, status: "ACTIVE" } });
  return rows.filter((r) => !isAccessExpired(r));
}

export async function hasFamilyPermission(familyMemberId: string, permission: string, scope?: string | null): Promise<boolean> {
  const active = await getFamilyPermissions(familyMemberId);
  return active.some((p) => p.permission === permission && (!p.scope || p.scope === (scope ?? "")));
}

// The specific-instance sharing decision (Decision 7) — null if this exact
// record was never shared with this family member, or the share has expired
// / been revoked. A FamilyPermission capability alone is never sufficient.
export async function getSharedRecord(familyMemberId: string, recordType: FamilySharedRecordType, recordId: string) {
  const row = await prisma.familySharedRecord.findUnique({
    where: { familyMemberId_recordType_recordId: { familyMemberId, recordType, recordId } },
  });
  if (!row || row.status !== "ACTIVE" || isAccessExpired(row)) return null;
  return row;
}

export async function canAccessRecord(familyMemberId: string, recordType: FamilySharedRecordType, recordId: string): Promise<boolean> {
  const permission = recordType === "PROPOSAL" ? "proposal.view" : "meeting.view";
  const [share, permitted] = await Promise.all([getSharedRecord(familyMemberId, recordType, recordId), hasFamilyPermission(familyMemberId, permission)]);
  return !!share && permitted;
}

export async function canComment(familyMemberId: string, recordType: FamilySharedRecordType, recordId: string): Promise<boolean> {
  const permission = recordType === "PROPOSAL" ? "proposal.comment" : "meeting.comment";
  const [share, permitted] = await Promise.all([getSharedRecord(familyMemberId, recordType, recordId), hasFamilyPermission(familyMemberId, permission)]);
  return !!share && share.allowComments && permitted;
}

export async function canSuggest(familyMemberId: string): Promise<boolean> {
  return hasFamilyPermission(familyMemberId, "profile.edit.suggest");
}

// Only true when: the proposal was shared at RESPONSE_PARTICIPATION level
// with allowResponse, AND the member holds proposal.respond. Even then, the
// result is always a non-binding FamilyDecision (Decision 8) — this check
// never authorizes a direct ProposalResponse write.
export async function canRespond(familyMemberId: string, proposalId: string): Promise<boolean> {
  const [share, permitted] = await Promise.all([getSharedRecord(familyMemberId, "PROPOSAL", proposalId), hasFamilyPermission(familyMemberId, "proposal.respond")]);
  return !!share && share.allowResponse && share.accessLevel === "RESPONSE_PARTICIPATION" && permitted;
}

export async function canManageMeeting(familyMemberId: string, meetingId: string): Promise<boolean> {
  const [share, permitted] = await Promise.all([getSharedRecord(familyMemberId, "MEETING", meetingId), hasFamilyPermission(familyMemberId, "meeting.confirm")]);
  return !!share && permitted;
}

// FAMILY_ADMIN's only capability: managing the family's OWN other members
// (invite/suspend/remove). Never checked against, or confused with, any
// AdminRole/Permission — there is no code path from a family session into
// requireAdmin() at all.
export async function canManageFamilyMembers(familyMemberId: string): Promise<boolean> {
  const membership = await getFamilyMembership(familyMemberId);
  return membership?.role === "FAMILY_ADMIN";
}

export async function canApprove(familyMemberId: string, proposalId: string): Promise<boolean> {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership || membership.role !== "FAMILY_APPROVER") return false;
  return canRespond(familyMemberId, proposalId);
}

export async function isConsentValid(familyMemberId: string, consentType: string): Promise<boolean> {
  const latest = await prisma.familyConsent.findFirst({
    where: { familyMemberId, consentType: consentType as never },
    orderBy: { grantedAt: "desc" },
  });
  if (!latest) return false;
  if (latest.status !== "GRANTED") return false;
  if (isAccessExpired(latest)) return false;
  return true;
}

// Full removal — sets REVOKED (not SUSPENDED), revokes every FamilyPermission
// and every active session immediately (Decision 11: enforced at read-time
// via getFamilyMembership's status check, and immediately via session
// revocation so an existing cookie stops working on the very next request).
export async function revokeAccess(familyMemberId: string, revokedByProfileId: string, reason?: string): Promise<void> {
  await prisma.$transaction([
    prisma.familyMember.update({ where: { id: familyMemberId }, data: { status: "REVOKED", removedAt: new Date() } }),
    prisma.familyPermission.updateMany({ where: { familyMemberId, revokedAt: null }, data: { status: "REVOKED", revokedAt: new Date() } }),
    prisma.familySharedRecord.updateMany({ where: { familyMemberId, status: "ACTIVE" }, data: { status: "REVOKED" } }),
  ]);
  await revokeAllFamilyMemberSessions(familyMemberId, reason ?? "member_removed");
  await writeAudit({ action: "FAMILY_MEMBER_REMOVED", targetProfileId: revokedByProfileId, actorFamilyMemberId: familyMemberId, meta: { reason } });
}

export async function suspendFamilyMember(familyMemberId: string, suspendedByProfileId: string, reason?: string): Promise<void> {
  await prisma.familyMember.update({ where: { id: familyMemberId }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendedReason: reason ?? null } });
  await revokeAllFamilyMemberSessions(familyMemberId, reason ?? "suspended");
  await writeAudit({ action: "FAMILY_MEMBER_SUSPENDED", targetProfileId: suspendedByProfileId, actorFamilyMemberId: familyMemberId, meta: { reason } });
}
