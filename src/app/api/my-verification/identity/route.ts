import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { createProviderSession, ProviderSessionError } from "@/lib/verification/provider/session";
import { writeAudit } from "@/lib/audit";

const VALID_DOCUMENT_TYPES = ["CNIC", "PASSPORT", "DRIVING_LICENSE", "NATIONAL_ID", "OTHER"];

export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const key = `verification-session:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const { documentType, country } = (await req.json().catch(() => ({}))) as { documentType?: string; country?: string };
  if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType) || !country?.trim()) {
    return NextResponse.json({ error: "A valid document type and country are required." }, { status: 400 });
  }

  try {
    const session = await createProviderSession(profileId, documentType, country.trim());
    await writeAudit({ action: "VERIFICATION_REQUESTED", targetProfileId: profileId, meta: { documentType, country: country.trim() } });
    return NextResponse.json({ redirectUrl: session.redirectUrl, instructions: session.instructions });
  } catch (error) {
    if (error instanceof ProviderSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
