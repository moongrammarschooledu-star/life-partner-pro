import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import type { UserReportStatus } from "@prisma/client";

// STEP 24 - applicant safety reports (allegations, never proof). Listed by code; the description is only returned
// to holders of user-reports:manage, and reporter identity is shown as a profile CODE only.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("user-reports:view");
    const status = new URL(req.url).searchParams.get("status");
    const rows = await prisma.userReport.findMany({
      where: status ? { status: status as UserReportStatus } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const ids = [...new Set(rows.flatMap((r) => [r.reporterProfileId, r.reportedProfileId]).filter((x): x is string => !!x))];
    const profiles = ids.length ? await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, profileCode: true } }) : [];
    const codeOf = new Map(profiles.map((p) => [p.id, p.profileCode]));
    const canReadText = admin.permissions.includes("user-reports:manage");
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        reportCode: r.reportCode,
        reportType: r.reportType,
        status: r.status,
        reporter: codeOf.get(r.reporterProfileId) ?? null,
        reported: r.reportedProfileId ? (codeOf.get(r.reportedProfileId) ?? null) : null,
        description: canReadText ? r.description : undefined,
        riskCaseId: r.riskCaseId,
        caseId: r.caseId,
        resolutionNote: r.resolutionNote,
        createdAt: r.createdAt,
      })),
      note: "Reports are allegations and have not been verified.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
