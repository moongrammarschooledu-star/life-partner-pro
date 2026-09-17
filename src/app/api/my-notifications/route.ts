import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientProfileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, title: true, body: true, actionUrl: true, readAt: true, createdAt: true, relatedProposalId: true },
    }),
    prisma.notification.count({ where: { recipientProfileId: profileId, readAt: null } }),
  ]);

  return NextResponse.json({ items: notifications, unreadCount });
}
