import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { verifyExportDownloadToken, readDataExport } from "@/lib/privacy/data-export";
import { writeAudit } from "@/lib/audit";

// Streaming, authenticated, audited — never a permanent public export URL
// (spec §21). Requires both the applicant's own session AND the short-lived
// signed download token issued at export creation.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await params;
  const token = new URL(req.url).searchParams.get("token");
  if (!verifyExportDownloadToken(token, id)) {
    return NextResponse.json({ error: "This download link has expired." }, { status: 403 });
  }

  const exportRequest = await prisma.dataExportRequest.findUnique({ where: { id } });
  if (!exportRequest || exportRequest.profileId !== profileId) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!exportRequest.secureStorageReference || !exportRequest.ivBase64 || !exportRequest.authTagBase64) {
    return NextResponse.json({ error: "Export is not ready." }, { status: 404 });
  }
  if (exportRequest.expiresAt && exportRequest.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "This export has expired." }, { status: 410 });
  }

  const buffer = await readDataExport({
    secureStorageReference: exportRequest.secureStorageReference,
    ivBase64: exportRequest.ivBase64,
    authTagBase64: exportRequest.authTagBase64,
  });

  await prisma.dataExportRequest.update({ where: { id }, data: { status: "DOWNLOADED", downloadedAt: new Date() } });
  await writeAudit({ action: "DATA_EXPORT_DOWNLOADED", targetProfileId: profileId, meta: { requestId: id } });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="life-partner-pro-data-export.json"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
