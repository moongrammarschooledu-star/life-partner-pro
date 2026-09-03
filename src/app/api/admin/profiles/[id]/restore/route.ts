import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:delete");
    const { id } = await params;

    await prisma.profile.update({ where: { id }, data: { softDeleted: false, status: "UNDER_REVIEW" } });
    await writeAudit({ action: "PROFILE_RESTORED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
