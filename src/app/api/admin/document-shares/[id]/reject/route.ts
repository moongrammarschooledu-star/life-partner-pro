import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { rejectShare } from "@/lib/documents/sharing-service";
import { str } from "@/lib/documents/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:share");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const share = await rejectShare(admin, id, str(body.reason, "reason", { max: 300 }));
    return NextResponse.json({ share });
  } catch (error) {
    return handleApiError(error);
  }
}
