import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Closes a confirmed gap: previously any admin holding the flat "note:add"
// permission (all of SUPER_ADMIN/ADMIN/STAFF) could pin or hard-delete ANY
// note on any profile. Now only the note's own author, or an admin holding
// "sensitive:notes:view" (SUPER_ADMIN/ADMIN), can edit or delete it.
function assertNoteOwnership(admin: { id: string; permissions: string[] }, note: { adminId: string }) {
  if (note.adminId !== admin.id && !admin.permissions.includes("sensitive:notes:view")) {
    throw new ApiError(403, "You can only edit or delete your own notes.");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const admin = await requireAdmin("note:add");
    const { id, noteId } = await params;
    const { pinned } = await req.json();

    const note = await prisma.profileNote.findFirst({ where: { id: noteId, profileId: id } });
    if (!note) throw new ApiError(404, "Note not found");
    assertNoteOwnership(admin, note);

    const updated = await prisma.profileNote.update({ where: { id: noteId }, data: { pinned: !!pinned } });
    return NextResponse.json({ id: updated.id, pinned: updated.pinned });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const admin = await requireAdmin("note:add");
    const { id, noteId } = await params;

    const note = await prisma.profileNote.findFirst({ where: { id: noteId, profileId: id } });
    if (!note) throw new ApiError(404, "Note not found");
    assertNoteOwnership(admin, note);

    await prisma.profileNote.delete({ where: { id: noteId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
