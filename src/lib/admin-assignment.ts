import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import type { AssignmentResourceType, AssignmentPriority } from "@prisma/client";

// Unified assignment-tracking table (spec §7/§8/§20) — additive alongside
// the existing Proposal/ProfileVerification/SecurityFlag assignedToId
// columns (those + their access-check helpers are untouched by this file).
// This is the ONLY backing store for PROFILE and FOLLOW_UP assignment.

export async function createAssignment(params: {
  adminId: string;
  resourceType: AssignmentResourceType;
  resourceId: string;
  priority?: AssignmentPriority;
  dueAt?: Date | null;
  notes?: string | null;
  createdById: string;
}) {
  const assignment = await prisma.adminAssignment.create({
    data: {
      adminId: params.adminId,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      priority: params.priority ?? "NORMAL",
      dueAt: params.dueAt ?? null,
      notes: params.notes ?? null,
      createdById: params.createdById,
    },
  });
  await writeAudit({
    action: "ASSIGNMENT_CREATED",
    adminId: params.createdById,
    meta: { assignmentId: assignment.id, resourceType: params.resourceType, resourceId: params.resourceId, assignedToId: params.adminId },
  });
  return assignment;
}

// Reassignment (spec §20): mark the latest open row REASSIGNED, insert a
// fresh ASSIGNED row, and write one audit record carrying the full
// previous→new trail plus the reason.
export async function reassignAssignment(params: {
  resourceType: AssignmentResourceType;
  resourceId: string;
  newAdminId: string;
  reason: string;
  createdById: string;
  priority?: AssignmentPriority;
  dueAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.adminAssignment.findFirst({
      where: { resourceType: params.resourceType, resourceId: params.resourceId, status: { not: "REASSIGNED" } },
      orderBy: { assignedAt: "desc" },
    });
    const previousAdminId = latest?.adminId ?? null;

    if (latest) {
      await tx.adminAssignment.update({ where: { id: latest.id }, data: { status: "REASSIGNED" } });
    }

    const created = await tx.adminAssignment.create({
      data: {
        adminId: params.newAdminId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        priority: params.priority ?? latest?.priority ?? "NORMAL",
        dueAt: params.dueAt ?? latest?.dueAt ?? null,
        notes: latest?.notes ?? null,
        createdById: params.createdById,
      },
    });

    await writeAudit({
      action: "ASSIGNMENT_REASSIGNED",
      adminId: params.createdById,
      meta: {
        assignmentId: created.id,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        previousAdminId,
        newAdminId: params.newAdminId,
        reason: params.reason,
      },
    });

    return created;
  });
}

// Resolves the current assignee for a resource tracked only in
// AdminAssignment (Profile, FollowUp) — used by the access-check helpers.
export async function getCurrentAssigneeId(resourceType: AssignmentResourceType, resourceId: string): Promise<string | null> {
  const latest = await prisma.adminAssignment.findFirst({
    where: { resourceType, resourceId, status: { not: "REASSIGNED" } },
    orderBy: { assignedAt: "desc" },
  });
  return latest?.adminId ?? null;
}
