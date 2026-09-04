import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    await requireAdmin("note:add");
    const { id, noteId } = await params;
    const { pinned } = await req.json();

    const note = await prisma.profileNote.findFirst({ where: { id: noteId, profileId: id } });
    if (!note) throw new ApiError(404, "Note not found");

    const updated = await prisma.profileNote.update({ where: { id: noteId }, data: { pinned: !!pinned } });
    return NextResponse.json({ id: updated.id, pinned: updated.pinned });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    await requireAdmin("note:add");
    const { id, noteId } = await params;

    const note = await prisma.profileNote.findFirst({ where: { id: noteId, profileId: id } });
    if (!note) throw new ApiError(404, "Note not found");

    await prisma.profileNote.delete({ where: { id: noteId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
