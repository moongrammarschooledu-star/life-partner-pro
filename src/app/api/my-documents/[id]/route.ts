import { NextResponse } from "next/server";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { handleApiError } from "@/lib/route-guard";
import { getDocumentOr404, softDeleteDocument } from "@/lib/documents/document-service";
import { requireDocumentAccess } from "@/lib/documents/access-service";
import { serializeDocument } from "@/lib/documents/serialize";
import { listVersions } from "@/lib/documents/document-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const document = await getDocumentOr404(id);
    await requireDocumentAccess({ type: "PROFILE", id: profileId }, document, "VIEW");
    const versions = await listVersions(id);
    return NextResponse.json({ document: serializeDocument(document), versions: versions.map((v) => ({ version: v.version, createdAt: v.createdAt, changeReason: v.changeReason, scanStatus: v.scanStatus })) });
  } catch (error) {
    return handleApiError(error);
  }
}

// Narrow self-service deletion only (see access-service.ts's DELETE case for PROFILE actors) — anything
// more significant (a verified document, one tied to a request) needs staff review instead.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const profileId = await requireApplicantProfileId();
    if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason : "Deleted by the applicant.";
    await softDeleteDocument({ type: "PROFILE", id: profileId }, id, reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
