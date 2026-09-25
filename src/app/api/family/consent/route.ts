import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.familyConsent.findMany({ where: { familyMemberId }, orderBy: { grantedAt: "desc" } });
  return NextResponse.json({ items });
}
