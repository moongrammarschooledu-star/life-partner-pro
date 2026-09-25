import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { resendInvitation, FamilyInvitationError } from "@/lib/family/invitation";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = `my-family-invitations-resend:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests. Please try again in a minute." }, { status: 429 });
  }

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  try {
    await resendInvitation(id, profileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyInvitationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
