import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { revokeFamilyMemberSession } from "@/lib/family/family-member-session";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const ok = await revokeFamilyMemberSession(id, familyMemberId);
  if (!ok) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
