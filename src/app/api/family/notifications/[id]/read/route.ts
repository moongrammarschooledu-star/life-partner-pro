import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  await prisma.notification.updateMany({ where: { id, recipientFamilyMemberId: familyMemberId, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}
