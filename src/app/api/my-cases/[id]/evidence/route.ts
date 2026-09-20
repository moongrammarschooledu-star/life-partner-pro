import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { saveCaseEvidence, EvidenceUploadError } from "@/lib/case-evidence-storage";
import { writeAudit } from "@/lib/audit";
import { safeFilename } from "@/lib/ops/upload-validation";
import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { blockedResponse } from "@/lib/ops/guards";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const blocked = await blockedResponse({ switches: ["uploads"], flags: ["uploads.enabled", "support.enabled"] });
  if (blocked) return blocked;
  const limited = await enforcePersistentLimit(req, "case-evidence-upload", 10, 60_000, profileId);
  if (limited) return limited;
  const { id } = await params;

  const caseRecord = await prisma.case.findUnique({ where: { id } });
  if (!caseRecord || caseRecord.reporterProfileId !== profileId) {
    return NextResponse.json({ error: "Case not found." }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "A file is required." }, { status: 400 });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveCaseEvidence(buffer, file.type);

    const evidence = await prisma.caseEvidence.create({
      data: {
        caseId: id,
        uploadedByProfileId: profileId,
        secureStorageReference: saved.secureStorageReference,
        ivBase64: saved.ivBase64,
        authTagBase64: saved.authTagBase64,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
        originalFilename: file.name ? safeFilename(file.name) : null,
      },
    });

    await writeAudit({ action: "EVIDENCE_UPLOADED", targetProfileId: profileId, meta: { caseId: id, evidenceId: evidence.id } });

    return NextResponse.json({ id: evidence.id, filename: evidence.originalFilename });
  } catch (error) {
    if (error instanceof EvidenceUploadError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Could not upload file." }, { status: 500 });
  }
}
