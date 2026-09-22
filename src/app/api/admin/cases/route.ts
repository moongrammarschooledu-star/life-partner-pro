import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { nextCaseNumber } from "@/lib/case-code";
import { isCategoryValidForType } from "@/lib/case-categories";
import { computeSlaDueDates } from "@/lib/case-sla";
import { typePermissionFor } from "@/lib/case-type-permission";
import { hasBroadRecordAccess } from "@/lib/permissions";
import type { CaseType, CaseCategory, CaseStatus, CasePriority } from "@prisma/client";

// Spec §29 — search/filter. Results are pre-filtered to what this admin is
// authorized to see: STAFF only ever sees cases they're assigned to or
// explicitly shared on (enforced by joining against AdminAssignment/
// CaseAccessGrant, not a client-side hide), and any case type the admin
// lacks the matching support:view/complaints:view/safety_cases:view
// permission for is excluded entirely — never returned then hidden.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("cases:view");
    const { searchParams } = new URL(req.url);

    const allowedTypes: CaseType[] = (["SUPPORT", "COMPLAINT", "SAFETY_REPORT", "INTERNAL"] as CaseType[]).filter((t) => {
      const perm = typePermissionFor(t, "view");
      return !perm || admin.permissions.includes(perm);
    });

    const status = searchParams.get("status") as CaseStatus | null;
    const priority = searchParams.get("priority") as CasePriority | null;
    const type = searchParams.get("type") as CaseType | null;
    const q = searchParams.get("q")?.trim();
    const assignedToId = searchParams.get("assignedToId");
    const scope = searchParams.get("scope"); // "mine" | "shared" | "unassigned" | null
    const relatedToProfileId = searchParams.get("relatedToProfileId");

    const where: Prisma.CaseWhereInput = {
      type: type ? type : { in: allowedTypes },
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      // AND array so q's OR and relatedToProfileId's OR never collide on the
      // same `where` key if ever combined.
      AND: [
        ...(q ? [{ OR: [{ caseNumber: { contains: q, mode: "insensitive" as const } }, { subject: { contains: q, mode: "insensitive" as const } }] }] : []),
        ...(relatedToProfileId ? [{ OR: [{ reporterProfileId: relatedToProfileId }, { reportedProfileId: relatedToProfileId }] }] : []),
      ],
      // Staff-conduct complaints never appear in a generic list for anyone
      // lacking the dedicated permission — closes the same conflict-of-
      // interest gap as case-access.ts's per-record check, at the list level.
      ...(admin.permissions.includes("cases:staff-conduct:view") ? {} : { reportedAdminId: null }),
    };

    if (!hasBroadRecordAccess(admin.role)) {
      // No assignment/share = no record access (spec §10) — a flat query
      // join, not a post-fetch filter, so nothing unauthorized is ever read.
      const [assignedCaseIds, sharedCaseIds] = await Promise.all([
        prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } }),
        prisma.caseAccessGrant.findMany({ where: { adminId: admin.id }, select: { caseId: true } }),
      ]);
      const visibleIds = [...new Set([...assignedCaseIds.map((a) => a.resourceId), ...sharedCaseIds.map((s) => s.caseId)])];
      where.id = { in: visibleIds };
    } else if (scope === "mine") {
      const assigned = await prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: admin.id, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
      where.id = { in: assigned.map((a) => a.resourceId) };
    } else if (assignedToId) {
      const assigned = await prisma.adminAssignment.findMany({ where: { resourceType: "CASE", adminId: assignedToId, status: { not: "REASSIGNED" } }, select: { resourceId: true } });
      where.id = { in: assigned.map((a) => a.resourceId) };
    }

    const cases = await prisma.case.findMany({
      where,
      select: {
        id: true, caseNumber: true, type: true, category: true, subject: true, priority: true, status: true,
        reporterProfile: { select: { id: true, fullName: true, profileCode: true } },
        reportedProfile: { select: { id: true, fullName: true, profileCode: true } },
        createdAt: true, updatedAt: true, resolutionDueAt: true, escalationLevel: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Assigned-staff name, resolved in bulk (AdminAssignment has no direct
    // Case relation to `include` through).
    const assignments = await prisma.adminAssignment.findMany({
      where: { resourceType: "CASE", resourceId: { in: cases.map((c) => c.id) }, status: { not: "REASSIGNED" } },
      select: { resourceId: true, admin: { select: { id: true, name: true } } },
    });
    const assigneeByCaseId = new Map(assignments.map((a) => [a.resourceId, a.admin]));

    return NextResponse.json({
      items: cases.map((c) => ({ ...c, assignedTo: assigneeByCaseId.get(c.id) ?? null })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Internal, staff-initiated case (spec §1 "Admin/staff can create internal
// cases").
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("cases:create");
    const body = await req.json();
    const { category, subject, description, reportedProfileId, reportedProfileCode, reportedAdminId, priority } = body as {
      category?: string; subject?: string; description?: string;
      reportedProfileId?: string; reportedProfileCode?: string; reportedAdminId?: string; priority?: CasePriority;
    };

    if (!category || !isCategoryValidForType("INTERNAL", category as CaseCategory)) {
      throw new ApiError(400, "A valid category is required.");
    }
    if (!subject?.trim() || !description?.trim()) throw new ApiError(400, "Subject and description are required.");

    if (reportedAdminId && !admin.permissions.includes("cases:staff-conduct:view")) {
      throw new ApiError(403, "You do not have permission to create a staff-conduct case.");
    }

    let resolvedReportedProfileId = reportedProfileId || null;
    if (!resolvedReportedProfileId && reportedProfileCode?.trim()) {
      const reported = await prisma.profile.findUnique({ where: { profileCode: reportedProfileCode.trim().toUpperCase() }, select: { id: true } });
      if (!reported) throw new ApiError(400, "No profile found with that Profile ID.");
      resolvedReportedProfileId = reported.id;
    }

    const caseNumber = await nextCaseNumber("INTERNAL");
    const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates(priority ?? "NORMAL");

    const created = await prisma.case.create({
      data: {
        caseNumber,
        type: "INTERNAL",
        category: category as CaseCategory,
        subject: subject.trim(),
        description: description.trim(),
        priority: priority ?? "NORMAL",
        reportedProfileId: resolvedReportedProfileId,
        reportedAdminId: reportedAdminId || null,
        createdById: admin.id,
        firstResponseDueAt,
        resolutionDueAt,
      },
    });

    await writeAudit({ action: "CASE_CREATED", adminId: admin.id, meta: { caseId: created.id, caseNumber, type: "INTERNAL", category } });

    return NextResponse.json({ id: created.id, caseNumber });
  } catch (error) {
    return handleApiError(error);
  }
}
