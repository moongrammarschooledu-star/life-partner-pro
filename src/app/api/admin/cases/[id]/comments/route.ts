import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { notifyCaseCommentAdded } from "@/lib/notifications/events";

// User-visible responses vs. internal back-and-forth among staff — never
// confused with /notes, which is staff-only investigation material (spec
// §13/§25). Requires only COMMENT-level access (a shared VIEW-level grant
// cannot post).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { id } = await params;
    const { body, visibleToUser } = (await req.json()) as { body?: string; visibleToUser?: boolean };
    if (!body?.trim()) throw new ApiError(400, "A message is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "COMMENT");

    const comment = await prisma.caseComment.create({
      data: { caseId: id, authorAdminId: admin.id, body: body.trim(), visibleToUser: visibleToUser !== false },
    });

    if (comment.visibleToUser) await notifyCaseCommentAdded(caseRecord.reporterProfileId);

    return NextResponse.json(comment);
  } catch (error) {
    return handleApiError(error);
  }
}
