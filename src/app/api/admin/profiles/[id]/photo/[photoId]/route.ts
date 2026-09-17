import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readPhoto } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { logPrivacyAccess } from "@/lib/privacy/access-log";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    const admin = await requireAdmin("profile:view");
    const { id, photoId } = await params;

    const photo = await prisma.profilePhoto.findFirst({ where: { id: photoId, profileId: id } });
    if (!photo) throw new ApiError(404, "Photo not found");

    const buffer = await readPhoto(photo.storageKey, photo.ivBase64, photo.authTagBase64);

    await writeAudit({ action: "PHOTO_VIEWED", adminId: admin.id, targetProfileId: id, meta: { photoId } });
    await logPrivacyAccess({ actorAdminId: admin.id, action: "PHOTO_VIEWED", field: "profilePhoto", targetProfileId: id });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
