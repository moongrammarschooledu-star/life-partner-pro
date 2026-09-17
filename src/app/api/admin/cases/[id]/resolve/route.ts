import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { typePermissionFor } from "@/lib/case-type-permission";
import { changeCaseStatus } from "@/lib/case-status";
import { notifyCaseResolved } from "@/lib/notifications/events";
import { writeAudit } from "@/lib/audit";
import type { ResolutionCategory } from "@prisma/client";

const VALID_CATEGORIES: ResolutionCategory[] = [
  "INFORMATION_PROVIDED", "USER_ISSUE_RESOLVED", "PROFILE_CORRECTED", "VERIFICATION_REQUESTED",
  "CONTACT_RESTRICTION_APPLIED", "PROFILE_RESTRICTED", "PROFILE_SUSPENDED", "CASE_ESCALATED",
  "NO_VIOLATION_CONFIRMED", "INSUFFICIENT_INFORMATION", "DUPLICATE_CASE", "OTHER_RESOLUTION",
];

// Spec §24 — structured resolution, deliberately neutral wording throughout
// (no accusatory public language).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:resolve");
    const { id } = await params;
    const { category, summary, actionTaken, followUpRequired, followUpDate } = (await req.json()) as {
      category?: string; summary?: string; actionTaken?: string; followUpRequired?: boolean; followUpDate?: string;
    };
    if (!category || !VALID_CATEGORIES.includes(category as ResolutionCategory)) throw new ApiError(400, "A valid resolution category is required.");
    if (!summary?.trim()) throw new ApiError(400, "A resolution summary is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    const typePerm = typePermissionFor(caseRecord.type, "resolve");
    if (typePerm && !admin.permissions.includes(typePerm)) {
      throw new ApiError(403, "You do not have permission to resolve this type of case.");
    }

    await prisma.caseResolution.upsert({
      where: { caseId: id },
      update: {
        category: category as ResolutionCategory, summary: summary.trim(), actionTaken: actionTaken || null,
        followUpRequired: !!followUpRequired, followUpDate: followUpDate ? new Date(followUpDate) : null, resolvedById: admin.id,
      },
      create: {
        caseId: id, category: category as ResolutionCategory, summary: summary.trim(), actionTaken: actionTaken || null,
        followUpRequired: !!followUpRequired, followUpDate: followUpDate ? new Date(followUpDate) : null, resolvedById: admin.id,
      },
    });

    await changeCaseStatus({ caseId: id, toStatus: "RESOLVED", adminId: admin.id, notifyUser: false });
    await writeAudit({ action: "CASE_RESOLUTION_CREATED", adminId: admin.id, meta: { caseId: id, category } });
    await notifyCaseResolved(caseRecord.reporterProfileId);

    return NextResponse.json({ ok: true, status: "RESOLVED" });
  } catch (error) {
    return handleApiError(error);
  }
}
