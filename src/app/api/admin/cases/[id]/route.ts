import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { assertCaseAccess } from "@/lib/case-access";
import { typePermissionFor } from "@/lib/case-type-permission";
import { getCurrentAssigneeId } from "@/lib/admin-assignment";

// Spec §9 — full case detail. Sensitive sub-resources (internal notes,
// evidence) are fetched via their own dedicated, separately-permissioned
// endpoints, not inlined here, so a lower-access viewer (VIEW-level via a
// CaseAccessGrant) gets the overview without accidentally receiving
// investigation material in the same payload.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:view");
    const { id } = await params;

    const caseRecord = await prisma.case.findUnique({
      where: { id },
      include: {
        reporterProfile: { select: { id: true, fullName: true, profileCode: true, city: true } },
        reportedProfile: { select: { id: true, fullName: true, profileCode: true } },
        reportedAdmin: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: "asc" }, include: { authorAdmin: { select: { name: true } }, authorProfile: { select: { fullName: true } } } },
        statusHistory: { orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true } } } },
        escalations: { orderBy: { createdAt: "asc" }, include: { escalatedBy: { select: { name: true } } } },
        resolution: { include: { resolvedBy: { select: { name: true } } } },
        evidence: { select: { id: true, mimeType: true, sizeBytes: true, originalFilename: true, createdAt: true, uploadedByAdminId: true, uploadedByProfileId: true } },
      },
    });
    if (!caseRecord) throw new ApiError(404, "Case not found");

    const typePerm = typePermissionFor(caseRecord.type, "view");
    if (typePerm && !admin.permissions.includes(typePerm)) throw new ApiError(404, "Case not found");

    const accessLevel = await assertCaseAccess(admin, caseRecord, "VIEW");
    const assignedTo = await getCurrentAssigneeId("CASE", id);
    const assignedAdmin = assignedTo ? await prisma.adminUser.findUnique({ where: { id: assignedTo }, select: { id: true, name: true } }) : null;

    await writeAudit({ action: "CASE_VIEWED", adminId: admin.id, meta: { caseId: id } });
    await prisma.caseAccessLog.create({ data: { caseId: id, adminId: admin.id, action: "VIEWED" } });

    return NextResponse.json({ ...caseRecord, accessLevel, assignedTo: assignedAdmin });
  } catch (error) {
    return handleApiError(error);
  }
}

// Generic field edits (priority/subject/description) — status/assign/
// escalate/resolve/close/reopen each have their own dedicated route with
// its own audit action and side effects (notifications, SLA recompute).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { id } = await params;
    const { priority, subject, description } = (await req.json()) as { priority?: string; subject?: string; description?: string };

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    const updated = await prisma.case.update({
      where: { id },
      data: {
        ...(subject !== undefined ? { subject: subject.trim() } : {}),
        ...(description !== undefined ? { description: description.trim() } : {}),
        ...(priority !== undefined ? { priority: priority as never } : {}),
      },
    });

    if (priority !== undefined) {
      await writeAudit({ action: "CASE_PRIORITY_CHANGED", adminId: admin.id, meta: { caseId: id, priority } });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
