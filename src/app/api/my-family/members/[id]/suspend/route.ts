import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { suspendFamilyMember } from "@/lib/family/access-control";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const member = await prisma.familyMember.findFirst({ where: { id, familyAccount: { applicantId: profileId } } });
  if (!member) return NextResponse.json({ error: "Family member not found." }, { status: 404 });

  const { reason } = await req.json().catch(() => ({ reason: undefined }));
  await suspendFamilyMember(id, profileId, reason);
  return NextResponse.json({ ok: true });
}
