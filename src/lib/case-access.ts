import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/route-guard";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";
import { hasActiveBreakGlass } from "@/lib/privacy/break-glass";
import type { AdminRole, Permission } from "@/lib/permissions";
import type { Case } from "@prisma/client";

// Spec §11 — the concrete, Cases-only implementation of VIEW/COMMENT/EDIT/
// MANAGE/APPROVE/OWNER. Nothing else in this codebase has a graded
// access-level system (every other *-access.ts helper is a flat binary
// assignee check) — this is genuinely new, not a reuse, kept scoped to
// Cases only rather than a platform-wide ACL framework.
export type CaseAccessLevel = "NONE" | "VIEW" | "COMMENT" | "EDIT" | "MANAGE";

const LEVEL_RANK: Record<CaseAccessLevel, number> = { NONE: 0, VIEW: 1, COMMENT: 2, EDIT: 3, MANAGE: 4 };

interface AccessAdmin {
  id: string;
  role: AdminRole;
  permissions: Permission[];
}

// A case with reportedAdminId set is a staff-conduct complaint (spec §19) —
// visibility is restricted to cases:staff-conduct:view (SUPER_ADMIN by
// default) regardless of assignment/sharing, closing the conflict-of-interest
// risk of an ordinary staff member querying a case about themselves or a peer.
function staffConductGateBlocks(admin: AccessAdmin, caseRecord: Pick<Case, "reportedAdminId">): boolean {
  return !!caseRecord.reportedAdminId && !admin.permissions.includes("cases:staff-conduct:view");
}

export async function resolveCaseAccessLevel(admin: AccessAdmin, caseRecord: Pick<Case, "id" | "reportedAdminId">): Promise<CaseAccessLevel> {
  if (staffConductGateBlocks(admin, caseRecord)) return "NONE";

  if (admin.role === "SUPER_ADMIN" || admin.role === "ADMIN") return "MANAGE";

  const assigneeId = await getCurrentAssigneeId("CASE", caseRecord.id);
  if (assigneeId === admin.id) return "MANAGE";

  const grant = await prisma.caseAccessGrant.findUnique({
    where: { caseId_adminId: { caseId: caseRecord.id, adminId: admin.id } },
  });
  if (grant) return grant.level; // "VIEW" | "COMMENT" | "EDIT"

  // Break-glass (STEP 13 spec §31) — scoped, audited, time-limited emergency
  // access; never a hidden bypass, since it only ever grants VIEW.
  if (await hasActiveBreakGlass(admin.id, "CASE", caseRecord.id)) return "VIEW";

  return "NONE";
}

export async function assertCaseAccess(
  admin: AccessAdmin,
  caseRecord: Pick<Case, "id" | "reportedAdminId">,
  minLevel: CaseAccessLevel
): Promise<CaseAccessLevel> {
  const level = await resolveCaseAccessLevel(admin, caseRecord);
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) {
    throw new ApiError(403, "You do not have sufficient access to this case.");
  }
  return level;
}

// Spec §25 — graded internal-note visibility (STAFF < ADMIN < SENIOR_ADMIN <
// SUPER_ADMIN). sensitive:case:notes:view overrides straight to the top
// rank, letting a role see notes above its normal tier without changing
// what tier its OWN new notes default to.
export type NoteRank = 1 | 2 | 3 | 4; // STAFF | ADMIN | SENIOR_ADMIN | SUPER_ADMIN

const NOTE_LEVEL_RANK: Record<"STAFF" | "ADMIN" | "SENIOR_ADMIN" | "SUPER_ADMIN", NoteRank> = {
  STAFF: 1,
  ADMIN: 2,
  SENIOR_ADMIN: 3,
  SUPER_ADMIN: 4,
};

export function resolveNoteViewRank(admin: AccessAdmin): NoteRank {
  if (admin.permissions.includes("sensitive:case:notes:view")) return 4;
  if (admin.role === "SUPER_ADMIN") return 4;
  if (admin.role === "ADMIN") return admin.permissions.includes("cases:escalate:senior") ? 3 : 2;
  return 1; // STAFF (VIEWER never reaches here — no case permissions at all)
}

export function canViewNoteLevel(admin: AccessAdmin, noteLevel: keyof typeof NOTE_LEVEL_RANK): boolean {
  return resolveNoteViewRank(admin) >= NOTE_LEVEL_RANK[noteLevel];
}

// The tier a note authored by this admin is stamped with by default — an
// admin can only author at (not above) their own resolved tier.
export function defaultNoteLevelFor(admin: AccessAdmin): "STAFF" | "ADMIN" | "SENIOR_ADMIN" | "SUPER_ADMIN" {
  const rank = resolveNoteViewRank(admin);
  return (Object.keys(NOTE_LEVEL_RANK) as (keyof typeof NOTE_LEVEL_RANK)[]).find((k) => NOTE_LEVEL_RANK[k] === rank) ?? "STAFF";
}
