import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { profileListInclude, profileDetailInclude, toListDto, toDetailDto } from "@/lib/serializers";
import { registrationSchema } from "@/lib/validation/registration";
import { savePhoto, UploadValidationError } from "@/lib/storage";
import { clientKeyFromRequest } from "@/lib/rate-limit";
import { createProfileFromRegistration, ProfileCreationError } from "@/lib/profile-creation";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("profile:view", { allowViewAs: true });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(50, Math.max(5, Number(searchParams.get("pageSize") ?? "20")));

    const q = searchParams.get("q")?.trim();
    const gender = searchParams.get("gender");
    const status = searchParams.get("status");
    const city = searchParams.get("city")?.trim();
    const minAge = searchParams.get("minAge");
    const maxAge = searchParams.get("maxAge");
    const education = searchParams.get("education")?.trim();
    const profession = searchParams.get("profession")?.trim();
    const maritalStatus = searchParams.get("maritalStatus");
    const verified = searchParams.get("verified");
    const includeArchived = searchParams.get("includeArchived") === "true";

    const where: Prisma.ProfileWhereInput = {
      softDeleted: false,
      ...(includeArchived ? {} : { status: { not: "ARCHIVED" } }),
      ...(gender ? { gender: gender as Prisma.EnumGenderFilter["equals"] } : {}),
      ...(status ? { status: status as never } : {}),
      ...(maritalStatus ? { maritalStatus: maritalStatus as never } : {}),
      ...(verified ? { verified: verified === "true" } : {}),
      ...(city ? { city: { contains: city } } : {}),
      ...(q
        ? {
            OR: [
              { fullName: { contains: q } },
              { profileCode: { contains: q } },
              { contact: { is: { mobileNumber: { contains: q } } } },
              { contact: { is: { whatsappNumber: { contains: q } } } },
            ],
          }
        : {}),
      ...(education ? { education: { is: { level: { contains: education } } } } : {}),
      ...(profession ? { profession: { is: { profession: { contains: profession } } } } : {}),
    };

    if (minAge || maxAge) {
      const now = new Date();
      const dobFilter: Prisma.DateTimeFilter = {};
      if (maxAge) dobFilter.gte = new Date(now.getFullYear() - Number(maxAge) - 1, now.getMonth(), now.getDate());
      if (minAge) dobFilter.lte = new Date(now.getFullYear() - Number(minAge), now.getMonth(), now.getDate());
      where.dateOfBirth = dobFilter;
    }

    const [total, profiles] = await Promise.all([
      prisma.profile.count({ where }),
      prisma.profile.findMany({
        where,
        include: profileListInclude,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      items: profiles.map((p) => toListDto(p, admin.permissions)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// Admin-initiated "Add New Profile" — for a walk-in / phone-in applicant
// whose details staff enter directly, without the applicant filling out the
// public wizard themselves. Reuses the exact same validation and creation
// path as self-service registration (createProfileFromRegistration), so a
// staff-entered profile is indistinguishable in shape or downstream
// behaviour from a self-registered one; the only difference is the
// AuditLog row is attributed to the admin (writeAudit's adminId), not the
// profile itself, and no applicant session cookie is issued here — the
// applicant never touched this browser.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("profile:edit");

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new ApiError(400, "Invalid submission.");
    }
    const rawPayload = formData.get("payload");
    if (typeof rawPayload !== "string") throw new ApiError(400, "Invalid submission.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new ApiError(400, "Invalid submission.");
    }

    const result = registrationSchema.safeParse(parsed);
    if (!result.success) {
      throw new ApiError(400, result.error.issues[0]?.message ?? "Please check the highlighted fields.");
    }
    const value = result.data;

    let photoData: { storageKey: string; mimeType: string; sizeBytes: number; ivBase64: string; authTagBase64: string } | null = null;
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      const buffer = Buffer.from(await photo.arrayBuffer());
      try {
        photoData = await savePhoto(buffer, photo.type);
      } catch (err) {
        if (err instanceof UploadValidationError) throw new ApiError(400, err.message);
        throw err;
      }
    }

    let profile;
    try {
      ({ profile } = await createProfileFromRegistration(value, photoData, {
        adminId: admin.id,
        ipHashSource: clientKeyFromRequest(req),
      }));
    } catch (err) {
      if (err instanceof ProfileCreationError) throw new ApiError(err.status, err.message);
      throw err;
    }

    const full = await prisma.profile.findUniqueOrThrow({ where: { id: profile.id }, include: profileDetailInclude });
    return NextResponse.json(toDetailDto(full, admin.id, admin.permissions), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
