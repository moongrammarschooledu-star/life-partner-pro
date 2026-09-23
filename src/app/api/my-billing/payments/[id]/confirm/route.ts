import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { recordManualPayment } from "@/lib/finance/manual-payment";
import { notifyManualPaymentRequiresReview } from "@/lib/notifications/events";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { createFromEvent } from "@/lib/workflow/engine";

// Applicant confirms they've made a bank transfer and submits the
// reference/evidence for admin review (spec §43/§44) — this never itself
// marks the payment PAID; only an admin's explicit verification does.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // STEP 15 §19 — persistent (cross-instance) rate limit.
  const limited = await enforcePersistentLimit(req, "billing-confirm", 10, 60000);
  if (limited) return limited;
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const { referenceNumber, evidenceDescription } = (await req.json()) as { referenceNumber?: string; evidenceDescription?: string };
  if (!referenceNumber?.trim()) return NextResponse.json({ error: "A payment reference is required." }, { status: 400 });

  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment || payment.profileId !== profileId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (payment.method !== "MANUAL") return NextResponse.json({ error: "This payment is not a manual payment." }, { status: 400 });

  const existing = await prisma.manualPaymentDetail.findUnique({ where: { paymentId: id } });
  if (existing) return NextResponse.json({ error: "A payment reference has already been submitted for this payment." }, { status: 409 });

  await recordManualPayment({ paymentId: id, referenceNumber: referenceNumber.trim(), evidenceDescription, submittedByProfileId: profileId });
  await prisma.payment.update({ where: { id }, data: { status: "PROCESSING" } });
  await notifyManualPaymentRequiresReview();
  await createFromEvent({
    eventName: "MANUAL_PAYMENT_REQUIRES_REVIEW",
    dedupKey: `MANUAL_PAYMENT_REQUIRES_REVIEW:${id}`,
    resourceType: "PAYMENT",
    resourceId: id,
    taskType: "PAYMENT_ISSUE_REVIEW",
    title: "Manual payment awaiting verification",
  });

  return NextResponse.json({ ok: true });
}
