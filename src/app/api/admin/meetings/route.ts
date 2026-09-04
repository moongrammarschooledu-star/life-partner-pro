import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Flat cross-proposal meeting list (spec §10) — scheduling/editing itself
// stays on the Proposal Detail page; this is a read-mostly upcoming/past view.
export async function GET() {
  try {
    await requireAdmin("proposal:create");

    const meetings = await prisma.meeting.findMany({
      include: {
        proposal: {
          select: {
            id: true,
            proposalCode: true,
            profileA: { select: { fullName: true, profileCode: true } },
            profileB: { select: { fullName: true, profileCode: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
    });

    const now = new Date();
    return NextResponse.json({
      upcoming: meetings.filter((m) => m.scheduledAt >= now && m.status !== "CANCELLED" && m.status !== "COMPLETED"),
      past: meetings.filter((m) => m.scheduledAt < now || m.status === "CANCELLED" || m.status === "COMPLETED"),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
