import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { prisma } from "@/lib/prisma";
import { quarantineFile } from "@/lib/documents/security-scanner";
import { deleteDocumentBytes } from "@/lib/documents/storage";
import { str } from "@/lib/documents/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const admin = await requireAdmin("documents:manage_providers");
    const { scanId } = await params;
    const body = await req.json().catch(() => ({}));
    const quarantine = await quarantineFile(scanId, admin.id, body.note ? str(body.note, "note", { max: 500, optional: true }) : undefined);
    const document = await prisma.document.update({ where: { id: quarantine.documentId }, data: { status: "DELETED", softDeletedAt: new Date() } });
    await deleteDocumentBytes(document.secureStorageReference);
    return NextResponse.json({ quarantine });
  } catch (error) {
    return handleApiError(error);
  }
}
