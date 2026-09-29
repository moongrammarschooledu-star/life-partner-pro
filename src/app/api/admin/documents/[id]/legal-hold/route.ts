import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { placeHold } from "@/lib/privacy/data-hold";
import { str } from "@/lib/documents/route-utils";

// A thin, document-specific convenience over the existing generic hold mechanism (src/lib/privacy/data-hold.ts,
// already used by the privacy center) — reused, not duplicated. Placing a hold just needs the permission;
// releasing one needs the STEP 19 gate (see [id]/legal-hold/release/route.ts).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:manage_legal_hold");
    const { id } = await params;
    const document = await prisma.document.findUnique({ where: { id }, select: { id: true, profileId: true } });
    if (!document) throw new ApiError(404, "Document not found.");
    const body = await req.json().catch(() => ({}));
    const hold = await placeHold({ recordType: "Document", recordId: id, profileId: document.profileId ?? undefined, reason: str(body.reason, "reason", { max: 500 }), placedById: admin.id });
    return NextResponse.json(hold, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
