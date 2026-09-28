import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

// The applicant's own communication history: what was sent to them, on which channel, and whether it was delivered.
// Safe fields only - no message body, no internal notes, no provider details, and only a masked address.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const rows = await prisma.communicationLog.findMany({
    where: { profileId, blockedReason: null, isTest: false, channel: { not: "IN_APP" }, createdBy: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, channel: true, notificationType: true, recipientReference: true, deliveryStatus: true, sentAt: true, deliveredAt: true, createdAt: true },
  });
  // A message the provider never confirmed is shown as "sent", never as "delivered".
  return NextResponse.json({ items: rows.map((r) => ({ id: r.id, channel: r.channel, about: r.notificationType, to: r.recipientReference, status: r.deliveryStatus, sentAt: r.sentAt, deliveredAt: r.deliveredAt, createdAt: r.createdAt })) });
}
