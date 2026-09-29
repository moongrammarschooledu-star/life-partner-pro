import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { handleApiError } from "@/lib/route-guard";
import { getDocumentOr404 } from "@/lib/documents/document-service";
import { requireDocumentAccess } from "@/lib/documents/access-service";
import { serializeDocument } from "@/lib/documents/serialize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const familyMemberId = await requireFamilyMemberId();
    if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const { id } = await params;
    const document = await getDocumentOr404(id);
    await requireDocumentAccess({ type: "FAMILY_MEMBER", id: familyMemberId }, document, "VIEW");
    return NextResponse.json({ document: serializeDocument(document) });
  } catch (error) {
    return handleApiError(error);
  }
}
