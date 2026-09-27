import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Read-only detail — review/resolve actions go through the existing
// PATCH /api/admin/security-flags/[id] (extended in STEP 23 to also accept
// risk:review/risk:resolve), since SecurityFlag is the single risk-signal
// store either surface acts on.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("risk:view");
    const { id } = await params;

    const flag = await prisma.securityFlag.findUnique({
      where: { id },
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true } },
        assignedTo: { select: { name: true } },
        resolvedBy: { select: { name: true } },
      },
    });
    if (!flag) throw new ApiError(404, "Risk signal not found");

    return NextResponse.json(flag);
  } catch (error) {
    return handleApiError(error);
  }
}
