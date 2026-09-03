import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { readPhoto } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  try {
    await requireAdmin("profile:view");
    const { id, photoId } = await params;

    const photo = await prisma.profilePhoto.findFirst({ where: { id: photoId, profileId: id } });
    if (!photo) throw new ApiError(404, "Photo not found");

    const buffer = await readPhoto(photo.storageKey);

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
