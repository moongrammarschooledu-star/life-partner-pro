import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:verify");
    const { id } = await params;

    const profile = await prisma.profile.update({ where: { id }, data: { verified: true, status: "VERIFIED" } });

    await writeAudit({ action: "PROFILE_VERIFIED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({ verified: profile.verified, status: profile.status });
  } catch (error) {
    return handleApiError(error);
  }
}
