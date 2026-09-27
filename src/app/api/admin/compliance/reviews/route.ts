import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

const OPEN_STATUSES = ["DRAFT", "PENDING_REVIEW", "LEGAL_REVIEW", "COMPLIANCE_REVIEW", "REVIEW_REQUIRED"] as const;

// The generic ComplianceReview due-list (plan decision 14 — "a due-list
// view sorted by dueDate, not a calendar-grid UI"). Covers any polymorphic
// review record created against a rule, processor, transfer, order, etc. —
// e.g. checkout.ts's flagOrderForTaxReview() writes exactly this shape.
export async function GET(req: Request) {
  try {
    await requireAdmin("compliance:review");
    const { searchParams } = new URL(req.url);
    const subjectType = searchParams.get("subjectType");

    const items = await prisma.complianceReview.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        ...(subjectType && { subjectType }),
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 200,
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
