import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { createAssignment, reassignAssignment } from "@/lib/admin-assignment";
import { notifyCrmAssignedToYou, notifyLeadAssignedToYou } from "@/lib/notifications/events";
import { HttpError } from "@/lib/http-error";
import type { AssignmentResourceType, CrmAssignmentRule } from "@prisma/client";

// STEP 28 §13-16 — CrmAssignmentService. Built entirely on the existing
// generic AdminAssignment ledger (src/lib/admin-assignment.ts) — CrmRecord.
// assignedStaffId/assignmentStatus are a denormalized fast-read cache kept
// in sync in the same transaction as every write here, exactly the same
// coexistence pattern Proposal.assignedToId already uses alongside
// AdminAssignment (see admin-assignment.ts's own header comment).

export async function assignRecord(resourceType: "LEAD" | "CRM_RECORD", resourceId: string, adminId: string, actorId: string) {
  await createAssignment({ adminId, resourceType, resourceId, createdById: actorId });

  if (resourceType === "CRM_RECORD") {
    await prisma.crmRecord.update({ where: { id: resourceId }, data: { assignedStaffId: adminId, assignmentStatus: "ASSIGNED" } });
    await notifyCrmAssignedToYou(adminId, resourceId).catch(() => undefined);
  } else {
    await prisma.lead.update({ where: { id: resourceId }, data: { assignedStaffId: adminId } });
    await notifyLeadAssignedToYou(adminId, resourceId).catch(() => undefined);
  }
  await writeAudit({ action: "CRM_ASSIGNED", adminId: actorId, meta: { resourceType, resourceId, assignedTo: adminId } });
}

export async function reassignRecord(resourceType: "LEAD" | "CRM_RECORD", resourceId: string, newAdminId: string, reason: string, actorId: string) {
  await reassignAssignment({ resourceType, resourceId, newAdminId, reason, createdById: actorId });

  if (resourceType === "CRM_RECORD") {
    await prisma.crmRecord.update({ where: { id: resourceId }, data: { assignedStaffId: newAdminId, assignmentStatus: "ASSIGNED" } });
    await notifyCrmAssignedToYou(newAdminId, resourceId).catch(() => undefined);
  } else {
    await prisma.lead.update({ where: { id: resourceId }, data: { assignedStaffId: newAdminId } });
    await notifyLeadAssignedToYou(newAdminId, resourceId).catch(() => undefined);
  }
  await writeAudit({ action: "CRM_REASSIGNED", adminId: actorId, meta: { resourceType, resourceId, newAdminId, reason } });
}

export async function setCrmAssignmentStatus(crmRecordId: string, status: "TRANSFERRED" | "ON_HOLD" | "CLOSED" | "UNASSIGNED", actorId: string) {
  const updated = await prisma.crmRecord.update({ where: { id: crmRecordId }, data: { assignmentStatus: status, assignedStaffId: status === "UNASSIGNED" ? null : undefined } });
  await writeAudit({ action: "CRM_REASSIGNED", adminId: actorId, meta: { crmRecordId, assignmentStatus: status } });
  return updated;
}

// STEP 28 §15 — honestly-scoped: ROUND_ROBIN is a rotating pointer,
// LEAST_LOADED counts open AdminAssignment rows, TEAM_BASED/SPECIALIZATION/
// GEOGRAPHIC narrow the eligible pool to a department for v1 (no per-admin
// specialization/geography field exists yet — disclosed, not silently
// approximated) before falling back to LEAST_LOADED as the tiebreak.
export async function autoAssign(resourceType: AssignmentResourceType, resourceId: string, departmentId: string | null, actorId: string): Promise<string | null> {
  const config = await prisma.assignmentRuleConfig.findUnique({ where: { resourceType_departmentId: { resourceType, departmentId: departmentId ?? "GLOBAL" } } }).catch(() => null);
  const rule: CrmAssignmentRule = config?.active ? config.rule : "MANUAL";
  if (rule === "MANUAL") return null;

  const eligibleAdmins = await prisma.adminUser.findMany({
    where: { active: true, ...(departmentId && (rule === "TEAM_BASED" || rule === "SPECIALIZATION" || rule === "GEOGRAPHIC") ? { departmentId } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (eligibleAdmins.length === 0) return null;

  let chosenId: string;
  if (rule === "ROUND_ROBIN") {
    const lastIdx = config?.lastAssignedId ? eligibleAdmins.findIndex((a) => a.id === config.lastAssignedId) : -1;
    chosenId = eligibleAdmins[(lastIdx + 1) % eligibleAdmins.length].id;
    await prisma.assignmentRuleConfig.upsert({
      where: { resourceType_departmentId: { resourceType, departmentId: departmentId ?? "GLOBAL" } },
      update: { lastAssignedId: chosenId },
      create: { resourceType, departmentId: departmentId ?? "GLOBAL", rule: "ROUND_ROBIN", lastAssignedId: chosenId },
    });
  } else {
    // LEAST_LOADED (also the tiebreak for TEAM_BASED/SPECIALIZATION/GEOGRAPHIC).
    const counts = await prisma.adminAssignment.groupBy({
      by: ["adminId"],
      where: { resourceType: { in: ["LEAD", "CRM_RECORD"] }, adminId: { in: eligibleAdmins.map((a) => a.id) }, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
      _count: { adminId: true },
    });
    const loadMap = new Map(counts.map((c) => [c.adminId, c._count.adminId]));
    chosenId = eligibleAdmins.reduce((min, a) => ((loadMap.get(a.id) ?? 0) < (loadMap.get(min.id) ?? 0) ? a : min), eligibleAdmins[0]).id;
  }

  await assignRecord(resourceType === "LEAD" ? "LEAD" : "CRM_RECORD", resourceId, chosenId, actorId);
  return chosenId;
}

export async function setAssignmentRule(resourceType: AssignmentResourceType, departmentId: string | null, rule: CrmAssignmentRule, actorId: string) {
  if (resourceType !== "LEAD" && resourceType !== "CRM_RECORD") throw new HttpError(400, "Assignment rules apply to LEAD or CRM_RECORD only.");
  const updated = await prisma.assignmentRuleConfig.upsert({
    where: { resourceType_departmentId: { resourceType, departmentId: departmentId ?? "GLOBAL" } },
    update: { rule },
    create: { resourceType, departmentId: departmentId ?? "GLOBAL", rule },
  });
  await writeAudit({ action: "CRM_BULK_ACTION", adminId: actorId, meta: { event: "assignment_rule_set", resourceType, departmentId, rule } });
  return updated;
}
