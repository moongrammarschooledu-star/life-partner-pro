import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { voidSignatureRequest } from "@/lib/documents/signature-service";
import { str } from "@/lib/documents/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:sign:manage");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const request = await voidSignatureRequest(admin, id, str(body.reason, "reason", { max: 300 }));
    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}
