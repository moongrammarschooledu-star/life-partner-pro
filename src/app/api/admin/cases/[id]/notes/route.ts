import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess, resolveNoteViewRank, canViewNoteLevel, defaultNoteLevelFor } from "@/lib/case-access";
import { writeAudit } from "@/lib/audit";

// Spec §25 — staff-only, graded-visibility investigation notes. Never
// exposed to the reporting user under any circumstance (there is no
// user-facing route that reads this table at all).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:view");
    const { id } = await params;

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "VIEW");

    const notes = await prisma.caseInternalNote.findMany({
      where: { caseId: id, deletedAt: null },
      include: { admin: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const visible = notes.filter((n) => canViewNoteLevel(admin, n.level));
    return NextResponse.json({ items: visible, viewerRank: resolveNoteViewRank(admin) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { id } = await params;
    const { body } = (await req.json()) as { body?: string };
    if (!body?.trim()) throw new ApiError(400, "A note body is required.");

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "COMMENT");

    const note = await prisma.caseInternalNote.create({
      data: { caseId: id, adminId: admin.id, body: body.trim(), level: defaultNoteLevelFor(admin) },
    });

    await writeAudit({ action: "CASE_NOTE_CREATED", adminId: admin.id, meta: { caseId: id, noteId: note.id, level: note.level } });

    return NextResponse.json(note);
  } catch (error) {
    return handleApiError(error);
  }
}
