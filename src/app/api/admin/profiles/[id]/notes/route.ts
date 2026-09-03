import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("note:add");
    const { id } = await params;
    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      throw new ApiError(400, "Note text is required");
    }

    const note = await prisma.profileNote.create({
      data: { profileId: id, adminId: admin.id, text: text.trim() },
      include: { admin: { select: { name: true } } },
    });

    await writeAudit({ action: "NOTE_ADDED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({ id: note.id, text: note.text, createdAt: note.createdAt, adminName: note.admin.name });
  } catch (error) {
    return handleApiError(error);
  }
}
