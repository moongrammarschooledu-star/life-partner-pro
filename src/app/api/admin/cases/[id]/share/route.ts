import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { writeAudit } from "@/lib/audit";
import type { CaseAccessLevel } from "@prisma/client";

const VALID_LEVELS: CaseAccessLevel[] = ["VIEW", "COMMENT", "EDIT"];

// Spec §11 — sharing a case at a specific graded level (see
// src/lib/case-access.ts). Requires MANAGE-level access on the case itself
// (the primary assignee or an ADMIN/SUPER_ADMIN), not just cases:assign.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:manage");
    const { id } = await params;
    const { adminId, level } = (await req.json()) as { adminId?: string; level?: string };
    if (!adminId || !level || !VALID_LEVELS.includes(level as CaseAccessLevel)) {
      throw new ApiError(400, "adminId and a valid level (VIEW/COMMENT/EDIT) are required.");
    }

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "MANAGE");

    const target = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!target || !target.active) throw new ApiError(400, "Invalid staff member.");

    const grant = await prisma.caseAccessGrant.upsert({
      where: { caseId_adminId: { caseId: id, adminId } },
      update: { level: level as CaseAccessLevel, grantedById: admin.id, grantedAt: new Date() },
      create: { caseId: id, adminId, level: level as CaseAccessLevel, grantedById: admin.id },
    });

    await writeAudit({ action: "CASE_ACCESS_SHARED", adminId: admin.id, meta: { caseId: id, sharedWithAdminId: adminId, level } });

    return NextResponse.json(grant);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:manage");
    const { id } = await params;
    const { adminId } = (await req.json()) as { adminId?: string };
    if (!adminId) throw new ApiError(400, "adminId is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "MANAGE");

    await prisma.caseAccessGrant.deleteMany({ where: { caseId: id, adminId } });
    await writeAudit({ action: "CASE_ACCESS_SHARED", adminId: admin.id, meta: { caseId: id, revokedFromAdminId: adminId } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
