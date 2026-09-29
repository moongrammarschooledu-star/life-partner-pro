import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { fetchDocumentBytes } from "@/lib/documents/document-service";
import { contentDisposition } from "@/lib/ops/upload-validation";

// Streams the decrypted bytes only through an authenticated route (never a raw storage URL, spec §7/§8) —
// exactly the same pattern already used for photos and STEP 8/23 verification documents in this codebase.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const { document, bytes } = await fetchDocumentBytes({ type: "PROFILE", id: profileId }, id, "DOWNLOAD");
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": document.mimeType, "Content-Disposition": contentDisposition(document.originalFilename, "attachment"), "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
