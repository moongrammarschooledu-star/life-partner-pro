import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const payments = await prisma.payment.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
    select: { id: true, paymentCode: true, amountMinor: true, currencyCode: true, method: true, status: true, createdAt: true, paidAt: true },
  });
  return NextResponse.json({ items: payments });
}
