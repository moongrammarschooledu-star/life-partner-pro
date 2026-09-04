import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { startOfDay, endOfDay } from "date-fns";
import { parseDateOnly } from "@/lib/utils";

const include = {
  profile: { select: { id: true, profileCode: true, fullName: true } },
  proposal: { select: { id: true, profileAId: true, profileBId: true } },
  admin: { select: { name: true } },
} as const;

export async function GET() {
  try {
    await requireAdmin("profile:view");

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [today, upcoming, overdue, completed, cancelled] = await Promise.all([
      prisma.followUp.findMany({ where: { status: "PENDING", dueDate: { gte: todayStart, lte: todayEnd } }, include, orderBy: { dueDate: "asc" } }),
      prisma.followUp.findMany({ where: { status: "PENDING", dueDate: { gt: todayEnd } }, include, orderBy: { dueDate: "asc" } }),
      prisma.followUp.findMany({ where: { status: "PENDING", dueDate: { lt: todayStart } }, include, orderBy: { dueDate: "asc" } }),
      prisma.followUp.findMany({ where: { status: "COMPLETED" }, include, orderBy: { completedAt: "desc" }, take: 50 }),
      prisma.followUp.findMany({ where: { status: "CANCELLED" }, include, orderBy: { dueDate: "desc" }, take: 50 }),
    ]);

    return NextResponse.json({ today, upcoming, overdue, completed, cancelled });
  } catch (error) {
    return handleApiError(error);
  }
}

// Direct creation, independent of logging a Communication — used by the
// "Add Follow-up" quick action on a profile or match panel (spec §37).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communication:add");
    const { profileId, proposalId, dueDate, title, priority, note, purpose } = await req.json();

    if (!profileId || !dueDate) throw new ApiError(400, "profileId and dueDate are required");

    const followUp = await prisma.followUp.create({
      data: {
        profileId,
        proposalId: proposalId || undefined,
        adminId: admin.id,
        dueDate: parseDateOnly(dueDate),
        title: title || null,
        note: note || null,
        purpose: purpose || null,
        priority: priority || "MEDIUM",
        status: "PENDING",
      },
    });

    await writeAudit({ action: "FOLLOW_UP_SCHEDULED", adminId: admin.id, targetProfileId: profileId, meta: { followUpId: followUp.id } });

    return NextResponse.json(followUp);
  } catch (error) {
    return handleApiError(error);
  }
}
