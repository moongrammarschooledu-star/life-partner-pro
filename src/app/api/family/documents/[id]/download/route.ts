import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { handleApiError } from "@/lib/route-guard";
import { fetchDocumentBytes } from "@/lib/documents/document-service";
import { contentDisposition } from "@/lib/ops/upload-validation";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const familyMemberId = await requireFamilyMemberId();
    if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const { document, bytes } = await fetchDocumentBytes({ type: "FAMILY_MEMBER", id: familyMemberId }, id, "DOWNLOAD");
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": document.mimeType, "Content-Disposition": contentDisposition(document.originalFilename, "attachment"), "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
