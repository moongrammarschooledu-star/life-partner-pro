import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { removeFromShortlist } from "@/lib/search/candidate-search";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const admin = await requireAdmin("candidate:shortlist");
    const { id, itemId } = await params;
    await removeFromShortlist(admin, id, itemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
