import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError, ApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { replaceDocument } from "@/lib/documents/document-service";
import { readForm, fileFromForm, str } from "@/lib/documents/route-utils";
import { serializeDocument } from "@/lib/documents/serialize";
import { DocumentUploadError } from "@/lib/documents/storage";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "my-documents-upload", { limit: 10, windowMs: 60_000 }, profileId);
    if (limited) return limited;
    const { id } = await params;
    const form = await readForm(req);
    const changeReason = str(form.get("changeReason"), "changeReason", { max: 300, optional: true }) || "Replaced by the applicant.";
    const { buffer, mimeType, filename } = await fileFromForm(form);

    try {
      const result = await replaceDocument({ documentId: id, uploaderType: "PROFILE", uploaderId: profileId, file: buffer, mimeType, filename, changeReason });
      return NextResponse.json({ document: serializeDocument(result.document), quarantined: result.quarantined }, { status: 201 });
    } catch (error) {
      if (error instanceof DocumentUploadError) throw new ApiError(400, error.message);
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
