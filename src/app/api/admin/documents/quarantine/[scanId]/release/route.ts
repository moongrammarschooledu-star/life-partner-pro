import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { releaseFile } from "@/lib/documents/security-scanner";
import { prisma } from "@/lib/prisma";
import { str } from "@/lib/documents/route-utils";

// Releasing a quarantined file back to AVAILABLE is a human decision, never automatic.
export async function POST(req: Request, { params }: { params: Promise<{ scanId: string }> }) {
  try {
    const admin = await requireAdmin("documents:manage_providers");
    const { scanId } = await params;
    const body = await req.json().catch(() => ({}));
    const quarantine = await releaseFile(scanId, admin.id, body.note ? str(body.note, "note", { max: 500, optional: true }) : undefined);
    await prisma.document.update({ where: { id: quarantine.documentId }, data: { status: "AVAILABLE", verificationStatus: "PENDING" } });
    return NextResponse.json({ quarantine });
  } catch (error) {
    return handleApiError(error);
  }
}
