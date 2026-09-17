import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.recipientProfileId !== profileId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await prisma.notification.update({ where: { id }, data: { readAt: notification.readAt ?? new Date() } });
  return NextResponse.json({ ok: true });
}
