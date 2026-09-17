import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { verifyApplicantReauthToken } from "@/lib/privacy/applicant-reauth";
import { submitPrivacyRequest } from "@/lib/privacy/privacy-request";

// Spec §14 — no financial/payment system exists in this app, so "check
// financial records" is N/A; active proposals/cases are surfaced to the
// applicant client-side as part of "what will become unavailable" before
// this is ever called, and to the admin reviewer for their own judgment.
export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { reauthToken, reason } = await req.json().catch(() => ({}));
  if (!verifyApplicantReauthToken(reauthToken, profileId)) {
    return NextResponse.json({ error: "Please reconfirm your identity before continuing." }, { status: 403 });
  }

  const existing = await prisma.accountDeletionRequest.findFirst({
    where: { profileId, status: { in: ["SUBMITTED", "UNDER_REVIEW", "SCHEDULED", "PROCESSING"] } },
  });
  if (existing) {
    return NextResponse.json({ error: "A deletion request is already in progress.", requestCode: existing.requestCode }, { status: 409 });
  }

  const request = await submitPrivacyRequest({ profileId, type: "DELETION", description: typeof reason === "string" ? reason : undefined });
  return NextResponse.json({ requestCode: request.requestCode });
}

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const requests = await prisma.accountDeletionRequest.findMany({ where: { profileId }, orderBy: { submittedAt: "desc" } });
  return NextResponse.json({ items: requests });
}
