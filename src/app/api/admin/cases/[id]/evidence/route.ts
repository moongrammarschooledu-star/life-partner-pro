import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertCaseAccess } from "@/lib/case-access";
import { saveCaseEvidence, EvidenceUploadError } from "@/lib/case-evidence-storage";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("sensitive:case:evidence:view");
    const { id } = await params;

    const caseRecord = await prisma.case.findUnique({ where: { id } });
    if (!caseRecord) throw new ApiError(404, "Case not found");
    await assertCaseAccess(admin, caseRecord, "COMMENT");

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "A file is required.");

    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveCaseEvidence(buffer, file.type);

    const evidence = await prisma.caseEvidence.create({
      data: {
        caseId: id,
        uploadedByAdminId: admin.id,
        secureStorageReference: saved.secureStorageReference,
        ivBase64: saved.ivBase64,
        authTagBase64: saved.authTagBase64,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        originalFilename: file.name || null,
      },
    });

    await writeAudit({ action: "EVIDENCE_UPLOADED", adminId: admin.id, meta: { caseId: id, evidenceId: evidence.id } });

    return NextResponse.json({ id: evidence.id, filename: evidence.originalFilename });
  } catch (error) {
    if (error instanceof EvidenceUploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    return handleApiError(error);
  }
}
