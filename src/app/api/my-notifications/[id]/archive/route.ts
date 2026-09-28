import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// Archive (or restore) one of the signed-in applicant's own notifications. Nothing is deleted.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const archive = body?.archived !== false;
  const result = await prisma.notification.updateMany({ where: { id, recipientProfileId: profileId }, data: { archivedAt: archive ? new Date() : null, ...(archive ? { readAt: new Date() } : {}) } });
  if (result.count === 0) return NextResponse.json({ error: "Not found." }, { status: 404 }); // same answer for "does not exist" and "not yours"
  return NextResponse.json({ ok: true, archived: archive });
}
