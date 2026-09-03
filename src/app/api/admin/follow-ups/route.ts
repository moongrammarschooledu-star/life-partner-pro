import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { startOfDay, endOfDay } from "date-fns";

export async function GET() {
  try {
    await requireAdmin("profile:view");

    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [today, upcoming, overdue] = await Promise.all([
      prisma.followUp.findMany({
        where: { done: false, dueDate: { gte: todayStart, lte: todayEnd } },
        include: { profile: { select: { id: true, profileCode: true, fullName: true } } },
        orderBy: { dueDate: "asc" },
      }),
      prisma.followUp.findMany({
        where: { done: false, dueDate: { gt: todayEnd } },
        include: { profile: { select: { id: true, profileCode: true, fullName: true } } },
        orderBy: { dueDate: "asc" },
      }),
      prisma.followUp.findMany({
        where: { done: false, dueDate: { lt: todayStart } },
        include: { profile: { select: { id: true, profileCode: true, fullName: true } } },
        orderBy: { dueDate: "asc" },
      }),
    ]);

    return NextResponse.json({ today, upcoming, overdue });
  } catch (error) {
    return handleApiError(error);
  }
}
