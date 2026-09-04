import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { subDays, endOfDay } from "date-fns";

export interface NotificationEntry {
  type: "verification" | "follow_up" | "match" | "proposal";
  label: string;
  count: number;
  href: string;
}

// Computed, not persisted — there is no Notification table. Each entry is a
// live count from data that already exists, assembled fresh on every call.
// This avoids the write-hook plumbing a real event-sourced notification
// system would need while still giving admins the "what needs my attention"
// signal the spec asks for (§40).
export async function GET() {
  try {
    await requireAdmin("profile:view");
    const now = new Date();

    const [awaitingVerification, followUpsDue, newMatches, proposalResponses] = await Promise.all([
      prisma.profile.count({ where: { softDeleted: false, verified: false, status: { in: ["NEW", "UNDER_REVIEW"] } } }),
      prisma.followUp.count({ where: { status: "PENDING", dueDate: { lte: endOfDay(now) } } }),
      prisma.match.count({ where: { status: "SUGGESTED", score: { gte: 80 }, createdAt: { gte: subDays(now, 2) } } }),
      prisma.proposal.count({ where: { updatedAt: { gte: subDays(now, 1) }, status: { in: ["INTERESTED", "NOT_INTERESTED"] } } }),
    ]);

    const entries: NotificationEntry[] = [];
    if (awaitingVerification > 0) {
      entries.push({ type: "verification", label: "Profiles awaiting verification", count: awaitingVerification, href: "/admin/profiles?status=UNDER_REVIEW" });
    }
    if (followUpsDue > 0) {
      entries.push({ type: "follow_up", label: "Follow-ups due or overdue", count: followUpsDue, href: "/admin/follow-ups" });
    }
    if (newMatches > 0) {
      entries.push({ type: "match", label: "New high-compatibility matches", count: newMatches, href: "/admin/matching" });
    }
    if (proposalResponses > 0) {
      entries.push({ type: "proposal", label: "Recent proposal responses", count: proposalResponses, href: "/admin/proposals" });
    }

    return NextResponse.json({ entries, total: entries.reduce((sum, e) => sum + e.count, 0) });
  } catch (error) {
    return handleApiError(error);
  }
}
