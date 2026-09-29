import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createSignatureRequest } from "@/lib/documents/signature-service";
import { oneOf, str } from "@/lib/documents/route-utils";

const RECIPIENT_TYPES = ["PROFILE", "FAMILY_MEMBER", "ADMIN"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:sign:manage");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) throw new ApiError(422, "At least one signer is required.");
    const recipients = body.recipients.map((r: unknown) => {
      const rec = r as Record<string, unknown>;
      return { recipientType: oneOf(rec.recipientType, RECIPIENT_TYPES, "recipientType"), recipientId: str(rec.recipientId, "recipientId", { max: 60 }) };
    });
    const request = await createSignatureRequest(admin, { documentId: id, recipients, message: body.message ? str(body.message, "message", { max: 1000 }) : undefined, expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : undefined });
    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
