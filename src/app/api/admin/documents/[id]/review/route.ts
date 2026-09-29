import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { reviewDocument, REJECTION_REASONS, type ReviewAction } from "@/lib/documents/verification-service";
import { oneOf, str } from "@/lib/documents/route-utils";

const ACTIONS: ReviewAction[] = ["APPROVE", "REJECT", "REQUEST_MORE_INFORMATION", "REQUEST_REUPLOAD", "MARK_REVERIFICATION_REQUIRED", "ESCALATE", "RESTRICT"];

// Generic review endpoint (spec §67's POST /review) — the named endpoints (approve/reject/request-info/
// reverify/restrict) are thin wrappers around this same service call.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:review");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await reviewDocument(admin, {
      documentId: id,
      action: oneOf(body.action, ACTIONS, "action"),
      reasonKey: body.reasonKey ? oneOf(body.reasonKey, REJECTION_REASONS, "reasonKey") : undefined,
      note: body.note ? str(body.note, "note", { max: 1000 }) : undefined,
    });
    return NextResponse.json(result, { status: "approvalRequired" in result && result.approvalRequired ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
