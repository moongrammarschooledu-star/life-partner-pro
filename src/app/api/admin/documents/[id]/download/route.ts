import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { fetchDocumentBytes } from "@/lib/documents/document-service";
import { contentDisposition } from "@/lib/ops/upload-validation";

// documents:download / sensitive:documents:download / sensitive:identity_documents:view are all enforced
// inside access-service.ts's decideDocumentAccess — this route only re-checks and logs (spec §24/§56).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:view");
    const { id } = await params;
    const { document, bytes } = await fetchDocumentBytes({ type: "ADMIN", id: admin.id, permissions: admin.permissions }, id, "DOWNLOAD");
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": document.mimeType, "Content-Disposition": contentDisposition(document.originalFilename, "attachment"), "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
