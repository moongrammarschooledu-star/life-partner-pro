import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { requestShare } from "@/lib/documents/sharing-service";
import { oneOf, str } from "@/lib/documents/route-utils";

const RECIPIENT_TYPES = ["FAMILY_MEMBER", "ADMIN", "PROFILE"] as const;
const SCOPES = ["VIEW", "DOWNLOAD"] as const;

// Sharing with another applicant (recipientType PROFILE) always needs STEP 19 approval, whoever requests
// it (spec §27/§28) — enforced inside requestShare, not here.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:share");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await requestShare(
      { type: "ADMIN", id: admin.id, permissions: admin.permissions },
      {
        documentId: id,
        recipientType: oneOf(body.recipientType, RECIPIENT_TYPES, "recipientType"),
        recipientId: str(body.recipientId, "recipientId", { max: 60 }),
        scope: body.scope ? oneOf(body.scope, SCOPES, "scope") : undefined,
        purpose: str(body.purpose, "purpose", { max: 300 }),
        expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : undefined,
      }
    );
    return NextResponse.json(result, { status: "approvalRequired" in result && result.approvalRequired ? 202 : 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
