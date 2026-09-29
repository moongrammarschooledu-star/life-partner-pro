import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { fetchDocumentBytes } from "@/lib/documents/document-service";
import { watermarkBytes } from "@/lib/documents/watermark";

// Secure inline preview (spec §32). HIGHLY_SENSITIVE/RESTRICTED documents are watermarked on the way out
// (a derived copy — see watermark.ts; the stored original is never touched). Never cached publicly.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:view");
    const { id } = await params;
    const { document, bytes } = await fetchDocumentBytes({ type: "ADMIN", id: admin.id, permissions: admin.permissions }, id, "PREVIEW");
    let out = bytes;
    if (document.classification === "HIGHLY_SENSITIVE" || document.classification === "RESTRICTED") {
      const watermarked = await watermarkBytes(bytes, document.mimeType, { documentCode: document.documentCode, viewerLabel: `Staff #${admin.id.slice(0, 6)}`, viewedAt: new Date() });
      out = watermarked.bytes;
    }
    return new NextResponse(new Uint8Array(out), { headers: { "Content-Type": document.mimeType, "Content-Disposition": "inline", "Cache-Control": "no-store, private" } });
  } catch (error) {
    return handleApiError(error);
  }
}
