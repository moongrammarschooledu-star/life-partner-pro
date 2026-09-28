import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { submitPrivacyRequest } from "@/lib/privacy/privacy-request";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import type { PrivacyRequestType, ConsentCategory } from "@prisma/client";

const VALID_TYPES: PrivacyRequestType[] = ["ACCESS", "CORRECTION", "DELETION", "RESTRICT_PROCESSING", "WITHDRAW_CONSENT", "EXPORT", "REPORT_ISSUE", "OTHER"];

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.privacyRequest.findMany({ where: { profileId }, orderBy: { submittedAt: "desc" } });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = await enforceConfiguredLimit(req, "my-privacy-requests", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { type, description, consentCategory } = (await req.json()) as { type?: string; description?: string; consentCategory?: ConsentCategory };
  if (!type || !VALID_TYPES.includes(type as PrivacyRequestType)) {
    return NextResponse.json({ error: "A valid request type is required." }, { status: 400 });
  }

  const request = await submitPrivacyRequest({ profileId, type: type as PrivacyRequestType, description, consentCategory });
  return NextResponse.json({ id: request.id, requestCode: request.requestCode });
}
