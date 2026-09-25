import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";

// This family member's own action history — never the applicant's full
// activity feed (that stays in /api/my-family/*, applicant-only).
export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.auditLog.findMany({
    where: { actorFamilyMemberId: familyMemberId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { action: true, createdAt: true },
  });

  return NextResponse.json({ items });
}
