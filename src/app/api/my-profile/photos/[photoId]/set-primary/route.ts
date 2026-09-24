import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { setPrimaryPhoto, PhotoManagementError } from "@/lib/photo-management";

export async function POST(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { photoId } = await params;

  try {
    await setPrimaryPhoto(profileId, photoId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PhotoManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
