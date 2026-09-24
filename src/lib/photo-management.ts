import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { savePhoto, readPhoto, deletePhoto, UploadValidationError, type PhotoTransformOptions } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { recomputeStoredCompleteness } from "@/lib/verification/status";

export class PhotoManagementError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "PhotoManagementError";
  }
}

// The codebase never had more than one photo per profile before STEP 21
// (registration allows exactly zero or one); this is a new, disclosed limit
// for the applicant-facing gallery, not a pre-existing constraint.
export const MAX_PHOTOS_PER_PROFILE = 6;

function toValidationError(err: unknown): PhotoManagementError {
  if (err instanceof UploadValidationError) return new PhotoManagementError(400, err.message);
  throw err;
}

export async function uploadApplicantPhoto(profileId: string, file: Buffer, mimeType: string) {
  const count = await prisma.profilePhoto.count({ where: { profileId } });
  if (count >= MAX_PHOTOS_PER_PROFILE) {
    throw new PhotoManagementError(400, `You can have at most ${MAX_PHOTOS_PER_PROFILE} photos.`);
  }

  let data;
  try {
    data = await savePhoto(file, mimeType);
  } catch (err) {
    throw toValidationError(err);
  }

  const photo = await prisma.profilePhoto.create({
    data: { profileId, storageKey: data.storageKey, mimeType: data.mimeType, sizeBytes: data.sizeBytes, ivBase64: data.ivBase64, authTagBase64: data.authTagBase64, isPrimary: count === 0 },
  });

  await writeAudit({ action: "PHOTO_UPLOADED", targetProfileId: profileId, meta: { photoId: photo.id } });
  await recomputeStoredCompleteness(profileId);
  return photo;
}

export interface UpdateApplicantPhotoInput extends PhotoTransformOptions {
  file?: Buffer;
  mimeType?: string;
}

// Handles both "replace with a newly uploaded file" (file provided) and
// "rotate/crop the existing stored photo in place" (no file — re-processes
// the currently stored bytes) through one function, since both end in the
// same re-encode-and-replace operation.
export async function updateApplicantPhoto(profileId: string, photoId: string, input: UpdateApplicantPhotoInput) {
  const existing = await prisma.profilePhoto.findFirst({ where: { id: photoId, profileId } });
  if (!existing) throw new PhotoManagementError(404, "Photo not found.");

  const sourceBuffer = input.file ?? (await readPhoto(existing.storageKey, existing.ivBase64, existing.authTagBase64));
  const sourceMime = input.file ? input.mimeType ?? "image/jpeg" : existing.mimeType;

  let data;
  try {
    data = await savePhoto(sourceBuffer, sourceMime, { rotateDegrees: input.rotateDegrees, cropRect: input.cropRect });
  } catch (err) {
    throw toValidationError(err);
  }

  await deletePhoto(existing.storageKey);
  const updated = await prisma.profilePhoto.update({
    where: { id: photoId },
    data: { storageKey: data.storageKey, mimeType: data.mimeType, sizeBytes: data.sizeBytes, ivBase64: data.ivBase64, authTagBase64: data.authTagBase64 },
  });

  await writeAudit({ action: "PHOTO_REPLACED", targetProfileId: profileId, meta: { photoId } });
  return updated;
}

// No minimum-photo-count is enforced — registration itself treats a photo
// as optional (zero photos is a valid, pre-existing state), so deletion
// down to zero is not a new gap this step introduces.
export async function deleteApplicantPhoto(profileId: string, photoId: string) {
  const existing = await prisma.profilePhoto.findFirst({ where: { id: photoId, profileId } });
  if (!existing) throw new PhotoManagementError(404, "Photo not found.");

  await prisma.profilePhoto.delete({ where: { id: photoId } });
  await deletePhoto(existing.storageKey);

  if (existing.isPrimary) {
    const next = await prisma.profilePhoto.findFirst({ where: { profileId }, orderBy: { createdAt: "asc" } });
    if (next) await prisma.profilePhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
  }

  await writeAudit({ action: "PHOTO_DELETED", targetProfileId: profileId, meta: { photoId } });
  await recomputeStoredCompleteness(profileId);
}

export async function setPrimaryPhoto(profileId: string, photoId: string) {
  const existing = await prisma.profilePhoto.findFirst({ where: { id: photoId, profileId } });
  if (!existing) throw new PhotoManagementError(404, "Photo not found.");

  await prisma.$transaction([
    prisma.profilePhoto.updateMany({ where: { profileId }, data: { isPrimary: false } }),
    prisma.profilePhoto.update({ where: { id: photoId }, data: { isPrimary: true } }),
  ]);

  await writeAudit({ action: "PHOTO_SET_PRIMARY", targetProfileId: profileId, meta: { photoId } });
}
