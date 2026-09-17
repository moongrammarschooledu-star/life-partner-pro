import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { revokeProfileSession } from "@/lib/profile-session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const ok = await revokeProfileSession(id, profileId);
  if (!ok) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
