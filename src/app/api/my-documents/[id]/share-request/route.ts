import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { requestShare } from "@/lib/documents/sharing-service";
import { oneOf, str } from "@/lib/documents/route-utils";

const RECIPIENT_TYPES = ["FAMILY_MEMBER", "ADMIN", "PROFILE"] as const;
const SCOPES = ["VIEW", "DOWNLOAD"] as const;

// The applicant requesting to share their OWN document (spec §27/§28). Sharing with another applicant
// (recipientType PROFILE — e.g. a proposal counterpart) always needs STEP 19 approval; family/admin
// grants activate immediately once this succeeds.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "my-documents-share-request", { limit: 10, windowMs: 60_000 }, profileId);
    if (limited) return limited;
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const result = await requestShare(
      { type: "PROFILE", id: profileId },
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
