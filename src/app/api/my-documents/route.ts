import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError, ApiError } from "@/lib/route-guard";
import { enforceConfiguredLimit } from "@/lib/security/rate-limit-policy";
import { createDocument } from "@/lib/documents/document-service";
import { listDocumentsForProfile, type CreateDocumentResult } from "@/lib/documents/document-service";
import { readForm, fileFromForm, str } from "@/lib/documents/route-utils";
import { serializeDocument } from "@/lib/documents/serialize";
import { DocumentUploadError } from "@/lib/documents/storage";

// The applicant's own document center list + self-upload. An applicant only ever uploads their OWN
// document (ownerType/uploaderType PROFILE) — never on behalf of anyone else.
export async function GET(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const includeArchived = new URL(req.url).searchParams.get("archived") === "true";
  const items = await listDocumentsForProfile(profileId, { includeArchived });
  return NextResponse.json({ items: items.map(serializeDocument) });
}

export async function POST(req: Request) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const limited = await enforceConfiguredLimit(req, "my-documents-upload", { limit: 10, windowMs: 60_000 }, profileId);
    if (limited) return limited;

    const form = await readForm(req);
    const typeKey = str(form.get("typeKey"), "typeKey", { max: 60 });
    const requestId = str(form.get("requestId"), "requestId", { max: 60, optional: true }) || undefined;
    const { buffer, mimeType, filename } = await fileFromForm(form);

    let result: CreateDocumentResult;
    try {
      result = await createDocument({ ownerType: "PROFILE", ownerId: profileId, profileId, typeKey, uploaderType: "PROFILE", uploaderId: profileId, file: buffer, mimeType, filename, requestId });
    } catch (error) {
      if (error instanceof DocumentUploadError) throw new ApiError(400, error.message);
      throw error;
    }
    return NextResponse.json({ document: serializeDocument(result.document), quarantined: result.quarantined }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
