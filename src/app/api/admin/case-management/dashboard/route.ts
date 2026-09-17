import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { classifySla } from "@/lib/case-sla";
import { typePermissionFor } from "@/lib/case-type-permission";
import { startOfDay } from "date-fns";
import type { CaseType } from "@prisma/client";

// Spec §7 — KPIs computed from real records, respecting the same
// type-permission + staff-conduct visibility rules as the list endpoint.
export async function GET() {
  try {
    const admin = await requireAdmin("cases:view");

    const allowedTypes: CaseType[] = (["SUPPORT", "COMPLAINT", "SAFETY_REPORT", "INTERNAL"] as CaseType[]).filter((t) => {
      const perm = typePermissionFor(t, "view");
      return !perm || admin.permissions.includes(perm);
    });

    const baseWhere = {
      type: { in: allowedTypes },
      ...(admin.permissions.includes("cases:staff-conduct:view") ? {} : { reportedAdminId: null }),
    };

    let scopeWhere = baseWhere;
    if (admin.role === "STAFF") {
      const [assigned, shared] = await Promise.all([
        prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } }),
        prisma.caseAccessGrant.findMany({ where: { adminId: admin.id }, select: { caseId: true } }),
      ]);
      const ids = [...new Set([...assigned.map((a) => a.resourceId), ...shared.map((s) => s.caseId)])];
      scopeWhere = { ...baseWhere, id: { in: ids } } as typeof baseWhere;
    }

    const [
      total, newCases, highPriority, urgentCritical, waitingForUser,
      resolvedToday, escalated, assignedToMeIds, openStatusRows,
    ] = await Promise.all([
      prisma.case.count({ where: scopeWhere }),
      prisma.case.count({ where: { ...scopeWhere, status: "NEW" } }),
      prisma.case.count({ where: { ...scopeWhere, priority: "HIGH" } }),
      prisma.case.count({ where: { ...scopeWhere, priority: { in: ["URGENT", "CRITICAL"] } } }),
      prisma.case.count({ where: { ...scopeWhere, status: "WAITING_FOR_USER" } }),
      prisma.case.count({ where: { ...scopeWhere, status: "RESOLVED", updatedAt: { gte: startOfDay(new Date()) } } }),
      prisma.case.count({ where: { ...scopeWhere, status: "ESCALATED" } }),
      prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } }),
      prisma.case.findMany({
        where: { ...scopeWhere, status: { notIn: ["RESOLVED", "CLOSED", "ARCHIVED"] } },
        select: { id: true, resolutionDueAt: true },
      }),
    ]);

    let overdue = 0;
    let dueSoon = 0;
    for (const c of openStatusRows) {
      const bucket = classifySla(c.resolutionDueAt);
      if (bucket === "OVERDUE") overdue++;
      else if (bucket === "DUE_SOON") dueSoon++;
    }

    return NextResponse.json({
      totalCases: total,
      newCases,
      openCases: total - (await prisma.case.count({ where: { ...scopeWhere, status: { in: ["RESOLVED", "CLOSED", "ARCHIVED"] } } })),
      highPriority,
      urgentCritical,
      assignedToMe: assignedToMeIds.length,
      waitingForUser,
      overdue,
      dueSoon,
      resolvedToday,
      escalatedCases: escalated,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
