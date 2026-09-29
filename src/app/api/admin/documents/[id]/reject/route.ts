import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { reviewDocument, REJECTION_REASONS } from "@/lib/documents/verification-service";
import { oneOf, str } from "@/lib/documents/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:reject");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await reviewDocument(admin, { documentId: id, action: "REJECT", reasonKey: oneOf(body.reasonKey, REJECTION_REASONS, "reasonKey"), note: body.note ? str(body.note, "note", { max: 1000 }) : undefined });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
