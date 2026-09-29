import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { restoreDocument } from "@/lib/documents/document-service";
import { serializeDocument } from "@/lib/documents/serialize";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("documents:restore");
    const { id } = await params;
    const updated = await restoreDocument({ type: "ADMIN", id: admin.id, permissions: admin.permissions }, id);
    return NextResponse.json({ document: serializeDocument(updated) });
  } catch (error) {
    return handleApiError(error);
  }
}
