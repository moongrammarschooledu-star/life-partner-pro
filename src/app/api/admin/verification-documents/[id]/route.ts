import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { readVerificationDocument } from "@/lib/verification/document-storage";
import type { DocumentReviewStatus } from "@prisma/client";

const VALID_REVIEW_STATUSES: DocumentReviewStatus[] = ["PENDING", "APPROVED", "REJECTED"];

// Streams the decrypted document bytes — never a raw <img src={blobUrl}>,
// never a public URL. Requires the stricter verification:document:view
// permission (deliberately not given to STAFF by default, spec §25) and
// audit-logs every single access.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("verification:document:view");
    const { id } = await params;

    const doc = await prisma.verificationDocument.findUnique({ where: { id } });
    if (!doc) throw new ApiError(404, "Document not found");

    const bytes = await readVerificationDocument(doc.secureStorageReference, doc.ivBase64, doc.authTagBase64);

    await writeAudit({ action: "ADMIN_ACCESSED_VERIFICATION_DOCUMENT", adminId: admin.id, targetProfileId: doc.profileId, meta: { documentId: id } });

    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": doc.mimeType, "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("verification:document:view");
    const { id } = await params;
    const { reviewStatus, reviewNote } = await req.json();

    if (!VALID_REVIEW_STATUSES.includes(reviewStatus)) throw new ApiError(400, "Invalid review status");

    const doc = await prisma.verificationDocument.update({
      where: { id },
      data: { reviewStatus, reviewNote: reviewNote || null, reviewedById: admin.id, reviewedAt: new Date() },
    });

    await writeAudit({ action: "DOCUMENT_REVIEWED", adminId: admin.id, targetProfileId: doc.profileId, meta: { documentId: id, reviewStatus } });

    return NextResponse.json({ id: doc.id, reviewStatus: doc.reviewStatus });
  } catch (error) {
    return handleApiError(error);
  }
}
