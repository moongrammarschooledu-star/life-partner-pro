import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// Mirrors STEP 11's own-note-only precedent (src/app/api/admin/profiles/
// [id]/notes/[noteId]/route.ts) — only the author, or a SUPER_ADMIN, may
// edit/delete an internal case note.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { noteId } = await params;
    const { body } = (await req.json()) as { body?: string };
    if (!body?.trim()) throw new ApiError(400, "A note body is required.");

    const note = await prisma.caseInternalNote.findUnique({ where: { id: noteId } });
    if (!note || note.deletedAt) throw new ApiError(404, "Note not found");
    if (note.adminId !== admin.id && admin.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "You can only edit your own notes.");
    }

    const updated = await prisma.caseInternalNote.update({ where: { id: noteId }, data: { body: body.trim(), editedAt: new Date() } });
    await writeAudit({ action: "CASE_NOTE_EDITED", adminId: admin.id, meta: { caseId: note.caseId, noteId } });

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const admin = await requireAdmin("cases:edit");
    const { noteId } = await params;

    const note = await prisma.caseInternalNote.findUnique({ where: { id: noteId } });
    if (!note || note.deletedAt) throw new ApiError(404, "Note not found");
    if (note.adminId !== admin.id && admin.role !== "SUPER_ADMIN") {
      throw new ApiError(403, "You can only delete your own notes.");
    }

    await prisma.caseInternalNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
    await writeAudit({ action: "CASE_NOTE_DELETED", adminId: admin.id, meta: { caseId: note.caseId, noteId } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
