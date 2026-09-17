import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { verifyApplicantReauthToken } from "@/lib/privacy/applicant-reauth";
import { submitPrivacyRequest } from "@/lib/privacy/privacy-request";
import { issueExportDownloadToken } from "@/lib/privacy/data-export";

export async function POST(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { reauthToken } = await req.json().catch(() => ({}));
  if (!verifyApplicantReauthToken(reauthToken, profileId)) {
    return NextResponse.json({ error: "Please reconfirm your identity before continuing." }, { status: 403 });
  }

  const request = await submitPrivacyRequest({ profileId, type: "EXPORT" });
  const linkedId = request.linkedRecordId!;
  return NextResponse.json({ requestId: linkedId, downloadToken: issueExportDownloadToken(linkedId) });
}

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const requests = await prisma.dataExportRequest.findMany({ where: { profileId }, orderBy: { requestedAt: "desc" }, take: 10 });
  return NextResponse.json({ items: requests.map((r) => ({ id: r.id, format: r.format, status: r.status, requestedAt: r.requestedAt, expiresAt: r.expiresAt })) });
}
