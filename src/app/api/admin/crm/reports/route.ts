import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Aggregate-only reporting (spec §19/§45) — pipeline counts by stage,
// assignment load per staff member, lead-source conversion, and SLA health;
// never a per-applicant ranked list, matching the "workload not a ranking"
// convention already established by /admin/team-workload.
export async function GET() {
  try {
    await requireAdmin("crm:reports:view");

    const [byStage, byAssignment, leadsBySource, leadsByStatus, overdueFollowups, slaBreaches] = await Promise.all([
      prisma.crmRecord.groupBy({ by: ["lifecycleStage"], _count: { lifecycleStage: true } }),
      prisma.crmRecord.groupBy({ by: ["assignedStaffId"], _count: { assignedStaffId: true } }),
      prisma.lead.groupBy({ by: ["source"], _count: { source: true } }),
      prisma.lead.groupBy({ by: ["status"], _count: { status: true } }),
      prisma.followUp.count({ where: { crmRecordId: { not: null }, slaState: { in: ["OVERDUE", "BREACHED"] } } }),
      prisma.followUp.count({ where: { crmRecordId: { not: null }, slaState: "BREACHED" } }),
    ]);

    return NextResponse.json({
      pipelineByStage: byStage.map((r) => ({ lifecycleStage: r.lifecycleStage, count: r._count.lifecycleStage })),
      assignmentLoad: byAssignment.map((r) => ({ assignedStaffId: r.assignedStaffId, count: r._count.assignedStaffId })),
      leadsBySource: leadsBySource.map((r) => ({ source: r.source, count: r._count.source })),
      leadsByStatus: leadsByStatus.map((r) => ({ status: r.status, count: r._count.status })),
      followupsOverdueOrBreached: overdueFollowups,
      followupsBreached: slaBreaches,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
