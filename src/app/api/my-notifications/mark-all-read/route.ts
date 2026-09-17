import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

export async function POST() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await prisma.notification.updateMany({ where: { recipientProfileId: profileId, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}
