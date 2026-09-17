import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { readPhoto } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { logPrivacyAccess } from "@/lib/privacy/access-log";

// Spec §24 — the first self-service photo-viewing route in this codebase
// (previously only the admin route existed); own-profile-only, mirrors the
// admin route's authenticated-stream pattern exactly.
export async function GET(_req: Request, { params }: { params: Promise<{ photoId: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { photoId } = await params;
  const photo = await prisma.profilePhoto.findFirst({ where: { id: photoId, profileId } });
  if (!photo) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const buffer = await readPhoto(photo.storageKey, photo.ivBase64, photo.authTagBase64);

  await writeAudit({ action: "PHOTO_VIEWED", targetProfileId: profileId, meta: { photoId } });
  await logPrivacyAccess({ actorProfileId: profileId, action: "PHOTO_VIEWED", field: "profilePhoto", targetProfileId: profileId });

  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": photo.mimeType, "Cache-Control": "private, max-age=3600" },
  });
}
