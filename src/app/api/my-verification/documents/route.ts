import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { saveVerificationDocument, DocumentUploadError } from "@/lib/verification/document-storage";
import { writeAudit } from "@/lib/audit";
import type { DocumentType } from "@prisma/client";

const VALID_TYPES: DocumentType[] = ["IDENTITY", "EDUCATION", "EMPLOYMENT", "OTHER"];

// Applicant self-uploads their own document (spec §7 — optional, admin only
// ever *reviews*, never uploads on a user's behalf). Gated by the same
// AppSettings toggle the admin Settings page controls.
export async function GET() {
  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const documents = await prisma.verificationDocument.findMany({
    where: { profileId },
    select: { id: true, documentType: true, reviewStatus: true, uploadedAt: true, reviewNote: true },
    orderBy: { uploadedAt: "desc" },
  });
  return NextResponse.json({ items: documents });
}

export async function POST(req: Request) {
  const key = `verification-doc-upload:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many uploads. Please try again in a minute." }, { status: 429 });
  }

  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings?.documentVerificationEnabled) {
    return NextResponse.json({ error: "Document verification is not currently enabled." }, { status: 403 });
  }

  try {
    const formData = await req.formData();
    const documentType = formData.get("documentType");
    const file = formData.get("file");
    if (typeof documentType !== "string" || !VALID_TYPES.includes(documentType as DocumentType)) {
      return NextResponse.json({ error: "Invalid document type." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "A file is required." }, { status: 400 });
    }

    const accepted: string[] | null = settings.acceptedDocumentTypes ? JSON.parse(settings.acceptedDocumentTypes) : null;
    if (accepted && !accepted.includes(documentType)) {
      return NextResponse.json({ error: "This document type is not currently accepted." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveVerificationDocument(buffer, file.type);

    const doc = await prisma.verificationDocument.create({
      data: {
        profileId,
        documentType: documentType as DocumentType,
        secureStorageReference: saved.secureStorageReference,
        ivBase64: saved.ivBase64,
        authTagBase64: saved.authTagBase64,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
      },
    });

    await writeAudit({ action: "DOCUMENT_UPLOADED", targetProfileId: profileId, meta: { documentId: doc.id, documentType } });

    return NextResponse.json({ id: doc.id, documentType: doc.documentType, reviewStatus: doc.reviewStatus, uploadedAt: doc.uploadedAt });
  } catch (error) {
    if (error instanceof DocumentUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
