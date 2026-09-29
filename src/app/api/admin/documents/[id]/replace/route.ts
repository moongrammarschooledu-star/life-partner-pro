import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { replaceDocument } from "@/lib/documents/document-service";
import { readForm, fileFromForm, str } from "@/lib/documents/route-utils";
import { serializeDocument } from "@/lib/documents/serialize";
import { DocumentUploadError } from "@/lib/documents/storage";

// An admin replacing a document on behalf of the platform (e.g. an administrative/agreement document) —
// never used to upload an applicant's identity document on their behalf (that stays self-service).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:upload");
    const { id } = await params;
    const form = await readForm(req);
    const changeReason = str(form.get("changeReason"), "changeReason", { max: 300 });
    const { buffer, mimeType, filename } = await fileFromForm(form);
    try {
      const result = await replaceDocument({ documentId: id, uploaderType: "ADMIN", uploaderId: admin.id, uploaderPermissions: admin.permissions, file: buffer, mimeType, filename, changeReason });
      return NextResponse.json({ document: serializeDocument(result.document), quarantined: result.quarantined }, { status: 201 });
    } catch (error) {
      if (error instanceof DocumentUploadError) throw new ApiError(400, error.message);
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
