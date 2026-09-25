import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { listFamilyMemberSessions } from "@/lib/family/family-member-session";

export async function GET() {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const sessions = await listFamilyMemberSessions(familyMemberId);
  return NextResponse.json({ items: sessions.map((s) => ({ id: s.id, deviceInfo: s.deviceInfo, lastActiveAt: s.lastActiveAt, createdAt: s.createdAt })) });
}
