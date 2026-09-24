import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { uploadApplicantPhoto, PhotoManagementError } from "@/lib/photo-management";
import { blockedResponse } from "@/lib/ops/guards";
import { prisma } from "@/lib/prisma";

// STEP 21 — self-service photo gallery (upload/replace/delete/set-primary).
// Non-sensitive, immediate self-service (Decision 2) — content-moderated
// implicitly by storage.ts's re-encode pipeline, not identity-bearing, so
// no admin review is required the way sensitive-field edits are.
export async function POST(req: Request) {
  const blocked = await blockedResponse({ switches: ["uploads"], flags: ["uploads.enabled"] });
  if (blocked) return blocked;

  const key = `my-profile-photo-upload:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 10, 60_000)) {
    return NextResponse.json({ error: "Too many uploads. Please try again in a minute." }, { status: 429 });
  }

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (await hasActiveRestriction(profileId, "CANNOT_UPDATE_FIELDS")) {
    return NextResponse.json({ error: "Your account currently can't update fields. Contact support for details." }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "A file is required." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const photo = await uploadApplicantPhoto(profileId, buffer, file.type);
    return NextResponse.json({ id: photo.id, isPrimary: photo.isPrimary, createdAt: photo.createdAt });
  } catch (error) {
    if (error instanceof PhotoManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const photos = await prisma.profilePhoto.findMany({
    where: { profileId },
    select: { id: true, mimeType: true, isPrimary: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ items: photos });
}
