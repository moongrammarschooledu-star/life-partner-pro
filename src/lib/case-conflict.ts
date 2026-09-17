import { prisma } from "@/lib/prisma";

// Spec §20 — a soft warning at assignment time, never a hard block ("the
// system should flag a potential conflict... authorized supervisor can
// reassign"). Checks whether the proposed assignee is the reporter, the
// reported admin (staff-conduct cases), or has previously touched the case
// as an assignee or note author.
export async function detectCaseConflictOfInterest(caseId: string, proposedAssigneeId: string): Promise<string[]> {
  const warnings: string[] = [];

  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    select: { reportedAdminId: true },
  });
  if (!caseRecord) return warnings;

  if (caseRecord.reportedAdminId === proposedAssigneeId) {
    warnings.push("This admin is the person being reported in this case.");
  }

  const [priorAssignment, priorNote] = await Promise.all([
    prisma.adminAssignment.findFirst({
      where: { resourceType: "CASE", resourceId: caseId, adminId: proposedAssigneeId },
      select: { id: true },
    }),
    prisma.caseInternalNote.findFirst({
      where: { caseId, adminId: proposedAssigneeId },
      select: { id: true },
    }),
  ]);
  if (priorAssignment) warnings.push("This admin was previously assigned to this case.");
  if (priorNote) warnings.push("This admin has already added investigation notes to this case.");

  return warnings;
}
