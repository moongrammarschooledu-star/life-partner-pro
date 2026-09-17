import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { writeAudit } from "@/lib/audit";
import type { CaseLinkType } from "@prisma/client";

const VALID_TYPES: CaseLinkType[] = ["RELATED_TO", "DUPLICATE_OF", "FOLLOW_UP_OF", "ESCALATION_OF", "EVIDENCE_FOR"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { id } = await params;
    const { linkedCaseId, linkType } = (await req.json()) as { linkedCaseId?: string; linkType?: string };
    if (!linkedCaseId || !linkType || !VALID_TYPES.includes(linkType as CaseLinkType)) {
      throw new ApiError(400, "linkedCaseId and a valid linkType are required.");
    }
    if (linkedCaseId === id) throw new ApiError(400, "A case cannot be linked to itself.");

    const [caseRecord, linkedCase] = await Promise.all([
      prisma.case.findUnique({ where: { id } }),
      prisma.case.findUnique({ where: { id: linkedCaseId } }),
    ]);
    if (!caseRecord || !linkedCase) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "EDIT");

    const link = await prisma.caseLink.create({
      data: { caseId: id, linkedCaseId, linkType: linkType as CaseLinkType, createdById: admin.id },
    });

    await writeAudit({ action: "CASE_LINKED", adminId: admin.id, meta: { caseId: id, linkedCaseId, linkType } });

    return NextResponse.json(link);
  } catch (error) {
    return handleApiError(error);
  }
}
