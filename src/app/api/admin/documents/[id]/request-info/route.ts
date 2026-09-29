import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { reviewDocument } from "@/lib/documents/verification-service";
import { str } from "@/lib/documents/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:review");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await reviewDocument(admin, { documentId: id, action: "REQUEST_MORE_INFORMATION", note: str(body.note, "note", { max: 1000 }) });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
