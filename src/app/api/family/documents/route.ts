import { NextResponse } from "next/server";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { handleApiError } from "@/lib/route-guard";
import { getSharedDocuments } from "@/lib/documents/sharing-service";
import { serializeDocument } from "@/lib/documents/serialize";

// Only documents EXPLICITLY shared with this family member (an active DocumentShare row) — profile access
// never implies document access (spec §26). "document.view" is checked again per-document by
// access-service.ts when the actual bytes are requested.
export async function GET() {
  try {
    const familyMemberId = await requireFamilyMemberId();
    if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    const items = await getSharedDocuments("FAMILY_MEMBER", familyMemberId);
    return NextResponse.json({ items: items.map(serializeDocument) });
  } catch (error) {
    return handleApiError(error);
  }
}
