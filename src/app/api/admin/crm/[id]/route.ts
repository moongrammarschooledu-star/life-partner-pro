import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCanSeeCrmRecord } from "@/lib/crm/access";
import { writeAudit } from "@/lib/audit";

// The "Applicant 360" detail read — a single CRM record plus the loose
// pointers its tabs need to resolve their own domain reads (each tab still
// runs its OWN access check independently, per src/lib/crm/access.ts's header
// comment: CRM visibility never substitutes for a linked domain's check).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:view");
    const { id } = await params;
    const record = await prisma.crmRecord.findUnique({
      where: { id },
      include: {
        profile: { select: { id: true, fullName: true, profileCode: true, gender: true, city: true, country: true, status: true, verified: true } },
        assignedStaff: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
      },
    });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);
    return NextResponse.json(record);
  } catch (error) {
    return handleApiError(error);
  }
}

// Archive/restore/priority-change — the small set of direct field edits that
// don't need their own dedicated sub-route (lifecycle/assign/tags/notes each
// have one, since those have their own validation/side effects).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("crm:edit");
    const { id } = await params;
    const body = (await req.json()) as { priority?: string; assignedTeamId?: string | null };

    const record = await prisma.crmRecord.findUnique({ where: { id } });
    if (!record) throw new ApiError(404, "CRM record not found.");
    assertCanSeeCrmRecord(admin, record);

    const updated = await prisma.crmRecord.update({
      where: { id },
      data: {
        ...(body.priority ? { priority: body.priority as never } : {}),
        ...(body.assignedTeamId !== undefined ? { assignedTeamId: body.assignedTeamId } : {}),
      },
    });
    await writeAudit({ action: "CRM_RECORD_EDITED", adminId: admin.id, targetProfileId: record.profileId, meta: { crmRecordId: id, changes: body } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
