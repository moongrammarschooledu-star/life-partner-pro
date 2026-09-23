import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("staff:availability:manage");
    const { id } = await params;
    const body = (await req.json()) as { active?: boolean; endAt?: string };

    const existing = await prisma.staffAvailability.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Not found.");

    const updated = await prisma.staffAvailability.update({
      where: { id },
      data: {
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.endAt !== undefined ? { endAt: new Date(body.endAt) } : {}),
      },
    });

    await writeAudit({ action: "STAFF_AVAILABILITY_UPDATED", adminId: admin.id, meta: { availabilityId: id } });
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
