import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { revokeInvitation, FamilyInvitationError } from "@/lib/family/invitation";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  try {
    await revokeInvitation(id, profileId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FamilyInvitationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
