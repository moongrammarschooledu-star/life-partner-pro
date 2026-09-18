import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const invoices = await prisma.invoice.findMany({
    where: { profileId },
    orderBy: { invoiceDate: "desc" },
    select: { id: true, invoiceCode: true, totalMinor: true, currencyCode: true, paymentStatus: true, invoiceDate: true },
  });
  return NextResponse.json({ items: invoices });
}
