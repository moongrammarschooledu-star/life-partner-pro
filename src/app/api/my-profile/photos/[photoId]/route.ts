import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { updateApplicantPhoto, deleteApplicantPhoto, PhotoManagementError } from "@/lib/photo-management";
import { blockedResponse } from "@/lib/ops/guards";

export async function PATCH(req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const blocked = await blockedResponse({ switches: ["uploads"], flags: ["uploads.enabled"] });
  if (blocked) return blocked;

  const key = `my-profile-photo-update:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (await hasActiveRestriction(profileId, "CANNOT_UPDATE_FIELDS")) {
    return NextResponse.json({ error: "Your account currently can't update fields. Contact support for details." }, { status: 403 });
  }

  const { photoId } = await params;

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const rotateDegrees = formData.get("rotateDegrees");
    const cropRectRaw = formData.get("cropRect");

    const photo = await updateApplicantPhoto(profileId, photoId, {
      file: file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : undefined,
      mimeType: file instanceof File ? file.type : undefined,
      rotateDegrees: typeof rotateDegrees === "string" && rotateDegrees ? Number(rotateDegrees) : undefined,
      cropRect: typeof cropRectRaw === "string" && cropRectRaw ? JSON.parse(cropRectRaw) : undefined,
    });

    return NextResponse.json({ id: photo.id, mimeType: photo.mimeType });
  } catch (error) {
    if (error instanceof PhotoManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (await hasActiveRestriction(profileId, "CANNOT_UPDATE_FIELDS")) {
    return NextResponse.json({ error: "Your account currently can't update fields. Contact support for details." }, { status: 403 });
  }

  const { photoId } = await params;

  try {
    await deleteApplicantPhoto(profileId, photoId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PhotoManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
