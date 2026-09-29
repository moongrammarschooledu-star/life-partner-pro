import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { approveShare } from "@/lib/documents/sharing-service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:share");
    const { id } = await params;
    const share = await approveShare(admin, id);
    return NextResponse.json({ share });
  } catch (error) {
    return handleApiError(error);
  }
}
