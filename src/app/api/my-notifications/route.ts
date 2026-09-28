import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

const CATEGORIES = ["PROPOSAL", "MEETING", "VERIFICATION", "SUPPORT", "PRIVACY", "SECURITY", "FAMILY", "PAYMENT", "SYSTEM"];

// Notification center: filter by category, unread only, or the archive. Only the signed-in applicant's own notifications.
export async function GET(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const q = new URL(req.url).searchParams;
  const archived = q.get("archived") === "true";
  const category = q.get("category");
  const where = {
    recipientProfileId: profileId,
    archivedAt: archived ? { not: null } : null,
    ...(category && CATEGORIES.includes(category) ? { category } : {}),
    ...(q.get("unread") === "true" ? { readAt: null } : {}),
  };

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, title: true, body: true, actionUrl: true, readAt: true, createdAt: true, relatedProposalId: true, priority: true, category: true, archivedAt: true },
    }),
    prisma.notification.count({ where: { recipientProfileId: profileId, readAt: null, archivedAt: null } }),
  ]);

  return NextResponse.json({ items: notifications, unreadCount, categories: CATEGORIES });
}
