import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { signDocument, declineSignature } from "@/lib/documents/signature-service";

// The signature ITSELF: an authenticated session + an explicit consent checkbox + the recipient's own
// typed full legal name (spec §42/§43) — see providers/local-signature-provider.ts for why this is not
// represented as a cryptographic/legally-binding signature.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body?.decline === true) {
      const declined = await declineSignature(id, "PROFILE", profileId, typeof body.reason === "string" ? body.reason : undefined);
      return NextResponse.json({ status: declined.status });
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const updated = await signDocument({
      requestId: id,
      recipientType: "PROFILE",
      recipientId: profileId,
      typedFullName: typeof body?.typedFullName === "string" ? body.typedFullName : "",
      consented: body?.consented === true,
      ipHash: ip ? createHash("sha256").update(ip).digest("hex") : undefined,
    });
    return NextResponse.json({ status: updated.status });
  } catch (error) {
    return handleApiError(error);
  }
}
