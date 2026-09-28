import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { ACTIVE_CASE_STATUSES } from "@/lib/risk/case-service";
import type { Prisma, RiskCaseStatus, RiskLevel, RiskSignalCategory } from "@prisma/client";

// STEP 24 - the risk case queue. Rows carry the profile CODE only (never contact details), and cases about a
// staff member are excluded unless the viewer holds a security permission - and are ALWAYS excluded for the
// subject themselves.
const LEVELS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("risk:view");
    const sp = new URL(req.url).searchParams;
    const status = sp.get("status");
    const level = sp.get("level");
    const category = sp.get("category");
    const q = sp.get("q")?.trim().toUpperCase();
    const take = Math.min(Math.max(Number(sp.get("take") ?? 50) || 50, 1), 100);
    const canSeeStaffCases = admin.permissions.includes("sensitive:security:view") || admin.permissions.includes("security:incidents:manage");

    const where: Prisma.RiskCaseWhereInput = {
      ...(status === "ACTIVE" ? { status: { in: ACTIVE_CASE_STATUSES } } : status ? { status: status as RiskCaseStatus } : {}),
      ...(level && LEVELS.includes(level as RiskLevel) ? { riskLevel: level as RiskLevel } : {}),
      ...(category ? { category: category as RiskSignalCategory } : {}),
      ...(sp.get("mine") === "1" ? { assignedToId: admin.id } : {}),
      ...(sp.get("overdue") === "1" ? { dueAt: { lt: new Date() }, status: { in: ACTIVE_CASE_STATUSES } } : {}),
      ...(q ? { riskCode: { contains: q } } : {}),
      ...(canSeeStaffCases ? { OR: [{ subjectAdminId: null }, { subjectAdminId: { not: admin.id } }] } : { subjectAdminId: null }),
    };

    const rows = await prisma.riskCase.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take,
      select: { id: true, riskCode: true, status: true, riskLevel: true, riskState: true, category: true, title: true, subjectProfileId: true, subjectAdminId: true, assignedToId: true, dueAt: true, createdAt: true, updatedAt: true },
    });
    const profileIds = rows.map((r) => r.subjectProfileId).filter((x): x is string => !!x);
    const profiles = profileIds.length ? await prisma.profile.findMany({ where: { id: { in: profileIds } }, select: { id: true, profileCode: true } }) : [];
    const codeOf = new Map(profiles.map((p) => [p.id, p.profileCode]));

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        riskCode: r.riskCode,
        status: r.status,
        riskLevel: r.riskLevel,
        riskState: r.riskState,
        category: r.category,
        title: r.title,
        subject: r.subjectAdminId ? { kind: "STAFF" } : { kind: "APPLICANT", profileCode: r.subjectProfileId ? (codeOf.get(r.subjectProfileId) ?? null) : null },
        assignedToId: r.assignedToId,
        overdue: !!r.dueAt && r.dueAt.getTime() < Date.now() && ACTIVE_CASE_STATUSES.includes(r.status),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
