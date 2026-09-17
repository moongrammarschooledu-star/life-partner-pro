import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { liftHold } from "@/lib/privacy/data-hold";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("privacy:hold:manage");
    const { id } = await params;
    const hold = await liftHold(id, admin.id);
    return NextResponse.json(hold);
  } catch (error) {
    return handleApiError(error);
  }
}
