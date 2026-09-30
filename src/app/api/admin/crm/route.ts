import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { hasBroadRecordAccess } from "@/lib/permissions";
import { createCrmRecord } from "@/lib/crm/crm-record-service";
import type { Prisma, CrmLifecycleStage, AssignmentStatus } from "@prisma/client";

// STEP 28 §17/§18 — CRM list view (table) + pipeline KPI counts. A scoped
// role (no crm:manager-equivalent broad access) only ever sees records
// assigned to it — the same "no assignment = no record access" rule as
// src/lib/workflow/access.ts and src/lib/case-access.ts, applied here via
// src/lib/crm/access.ts's canSeeCrmRecord logic expressed as a query filter.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("crm:view");
    const { searchParams: q } = new URL(req.url);

    const where: Prisma.CrmRecordWhereInput = {
      ...(q.get("lifecycleStage") ? { lifecycleStage: q.get("lifecycleStage") as CrmLifecycleStage } : {}),
      ...(q.get("assignmentStatus") ? { assignmentStatus: q.get("assignmentStatus") as AssignmentStatus } : {}),
      ...(q.get("assignedStaffId") ? { assignedStaffId: q.get("assignedStaffId") } : {}),
      ...(!hasBroadRecordAccess(admin.role) ? { assignedStaffId: admin.id } : {}),
    };

    const [items, kpiRows] = await Promise.all([
      prisma.crmRecord.findMany({
        where,
        include: {
          profile: { select: { id: true, fullName: true, profileCode: true } },
          assignedStaff: { select: { id: true, name: true } },
        },
        orderBy: { lastActivityAt: "desc" },
        take: 200,
      }),
      prisma.crmRecord.groupBy({ by: ["lifecycleStage"], where, _count: { lifecycleStage: true } }),
    ]);

    return NextResponse.json({
      items,
      kpi: kpiRows.map((r) => ({ lifecycleStage: r.lifecycleStage, count: r._count.lifecycleStage })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Manual creation of a CRM record for an existing applicant with no lead
// (spec §2's "created automatically or manually"). Lead-originated records
// are created via /api/admin/crm/leads/[id]/convert instead.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("crm:create");
    const body = (await req.json()) as { profileId?: string };
    if (!body.profileId) throw new ApiError(400, "profileId is required.");

    const profile = await prisma.profile.findUnique({ where: { id: body.profileId }, select: { id: true } });
    if (!profile) throw new ApiError(404, "Profile not found.");

    const record = await createCrmRecord(body.profileId, { actorId: admin.id });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
