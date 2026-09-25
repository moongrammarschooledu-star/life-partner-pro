import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { recipientFamilyMemberId: familyMemberId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, title: true, body: true, actionUrl: true, readAt: true, createdAt: true },
    }),
    prisma.notification.count({ where: { recipientFamilyMemberId: familyMemberId, readAt: null } }),
  ]);

  return NextResponse.json({ items, unreadCount });
}
