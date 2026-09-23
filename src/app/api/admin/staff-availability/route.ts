import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

// STEP 18 §44 — temporary unavailability + backup routing. New tasks may
// route to backupAdminId when configured (see automatic-assignment call
// sites); existing tasks are never automatically moved.
export async function GET() {
  try {
    await requireAdmin("staff:availability:manage");
    const items = await prisma.staffAvailability.findMany({
      where: { active: true },
      orderBy: { startAt: "desc" },
      include: { admin: { select: { id: true, name: true } }, backupAdmin: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("staff:availability:manage");
    const body = (await req.json()) as { adminId?: string; startAt?: string; endAt?: string; reason?: string; backupAdminId?: string };
    if (!body.adminId || !body.startAt || !body.endAt) throw new ApiError(400, "adminId, startAt and endAt are required.");
    if (new Date(body.endAt) <= new Date(body.startAt)) throw new ApiError(400, "endAt must be after startAt.");

    const created = await prisma.staffAvailability.create({
      data: {
        adminId: body.adminId,
        startAt: new Date(body.startAt),
        endAt: new Date(body.endAt),
        reason: body.reason ?? null,
        backupAdminId: body.backupAdminId ?? null,
        createdById: admin.id,
      },
    });

    await writeAudit({ action: "STAFF_AVAILABILITY_CREATED", adminId: admin.id, meta: { availabilityId: created.id, forAdminId: body.adminId } });
    return NextResponse.json(created);
  } catch (error) {
    return handleApiError(error);
  }
}
