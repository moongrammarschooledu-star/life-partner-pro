import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getSignatureRequest } from "@/lib/documents/signature-service";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("documents:sign:manage");
    const { id } = await params;
    const result = await getSignatureRequest(id);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
