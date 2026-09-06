import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { profileListInclude, toListDto } from "@/lib/serializers";

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
