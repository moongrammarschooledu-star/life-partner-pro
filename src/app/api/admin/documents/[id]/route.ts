import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getDocumentOr404, listVersions } from "@/lib/documents/document-service";
import { requireDocumentAccess } from "@/lib/documents/access-service";
import { serializeDocument } from "@/lib/documents/serialize";
import { getReviewHistory } from "@/lib/documents/verification-service";
import { listSharesForDocument } from "@/lib/documents/sharing-service";

// Document detail page data (spec §69): metadata, version history, review history, share status. The
// sensitive file preview itself is a separate, permission-gated route (see [id]/preview, [id]/download).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:view");
    const { id } = await params;
    const document = await getDocumentOr404(id);
    await requireDocumentAccess({ type: "ADMIN", id: admin.id, permissions: admin.permissions }, document, "VIEW");
    const [versions, history, shares] = await Promise.all([listVersions(id), getReviewHistory(id), listSharesForDocument(id)]);
    return NextResponse.json({
      document: serializeDocument(document),
      versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, changeReason: v.changeReason, scanStatus: v.scanStatus, uploaderType: v.uploaderType })),
      history,
      shares,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
