import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { prisma } from "@/lib/prisma";
import { PhotoManagementError, setPrimaryPhoto, uploadApplicantPhoto } from "@/lib/photo-management";

// An administrator can add a photo to a profile (for example one that was sent on WhatsApp). It goes through exactly the same checks and processing as a photo
// the person uploads themselves (type, size, EXIF/GPS stripped, resized, encrypted at rest), becomes the main photo, and the audit row names the administrator.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:edit");
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);

    const profile = await prisma.profile.findUnique({ where: { id }, select: { id: true, softDeleted: true } });
    if (!profile || profile.softDeleted) throw new ApiError(404, "Profile not found");

    const formData = await req.formData();
    const file = formData.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Please choose a photo.");

    try {
      const photo = await uploadApplicantPhoto(id, Buffer.from(await file.arrayBuffer()), file.type, admin.id);
      if (!photo.isPrimary) await setPrimaryPhoto(id, photo.id, admin.id);
      return NextResponse.json({ ok: true, photoId: photo.id });
    } catch (err) {
      if (err instanceof PhotoManagementError) throw new ApiError(err.status, err.message);
      throw err;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
