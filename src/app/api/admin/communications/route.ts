import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { parseDateOnly } from "@/lib/utils";

// Communications were previously write-only from the UI's perspective —
// logged per profile but never listed back. This closes that gap.
export async function GET(req: Request) {
  try {
    await requireAdmin("profile:view");
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");
    if (!profileId) throw new ApiError(400, "profileId is required");

    const items = await prisma.communication.findMany({
      where: { profileId },
      include: { admin: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
    });

    return NextResponse.json({
      items: items.map((c) => ({
        id: c.id,
        type: c.type,
        notes: c.notes,
        occurredAt: c.occurredAt,
        followUpDate: c.followUpDate,
        adminName: c.admin.name,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communication:add");
    const body = await req.json();
    const { profileId, type, notes, occurredAt, followUpDate } = body;

    if (!profileId || !type) throw new ApiError(400, "profileId and type are required");

    const communication = await prisma.communication.create({
      data: {
        profileId,
        adminId: admin.id,
        type,
        notes: notes || null,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        followUpDate: followUpDate ? parseDateOnly(followUpDate) : null,
      },
    });

    if (followUpDate) {
      await prisma.followUp.create({
        data: { profileId, dueDate: parseDateOnly(followUpDate), note: notes || null, status: "PENDING" },
      });
    }

    await writeAudit({ action: "COMMUNICATION_LOGGED", adminId: admin.id, targetProfileId: profileId, meta: { type } });

    return NextResponse.json(communication);
  } catch (error) {
    return handleApiError(error);
  }
}
