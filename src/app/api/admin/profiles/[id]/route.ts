import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { writeAudit } from "@/lib/audit";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:view", { allowViewAs: true });
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);

    const profile = await prisma.profile.findUnique({ where: { id }, include: profileDetailInclude });
    if (!profile) throw new ApiError(404, "Profile not found");

    await writeAudit({ action: "PROFILE_VIEWED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json(toDetailDto(profile, admin.id, admin.permissions));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:edit");
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);
    const body = await req.json();

    const existing = await prisma.profile.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Profile not found");

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        fullName: body.fullName,
        city: body.city,
        area: body.area || null,
        country: body.country,
        heightCm: body.heightCm ? Number(body.heightCm) : undefined,
        education: body.education ? { update: body.education } : undefined,
        profession: body.profession ? { update: body.profession } : undefined,
        family: body.family ? { update: body.family } : undefined,
        lifestyle: body.lifestyle ? { update: body.lifestyle } : undefined,
        preference: body.preference ? { update: body.preference } : undefined,
      },
      include: profileDetailInclude,
    });

    await writeAudit({ action: "PROFILE_EDITED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json(toDetailDto(profile, admin.id, admin.permissions));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:delete");
    const { id } = await params;

    await prisma.profile.update({ where: { id }, data: { softDeleted: true, status: "ARCHIVED" } });
    await writeAudit({ action: "PROFILE_DELETED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
