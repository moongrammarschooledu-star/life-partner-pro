import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { contentDisposition } from "@/lib/ops/upload-validation";
import { assertCaseAccess } from "@/lib/case-access";
import { readCaseEvidence } from "@/lib/case-evidence-storage";

// Streams the decrypted evidence bytes — never a raw blob URL (spec §12),
// mirrors GET /api/admin/verification-documents/[id] exactly. Requires
// sensitive:case:evidence:view AND case-level VIEW access; every access is
// audited both centrally (AuditLog) and per-case (CaseAccessLog).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("sensitive:case:evidence:view");
    const { id } = await params;

    const evidence = await prisma.caseEvidence.findUnique({ where: { id }, include: { case: true } });
    if (!evidence) throw new ApiError(404, "Evidence not found");

    await assertCaseAccess(admin, evidence.case, "VIEW");

    const bytes = await readCaseEvidence(evidence.secureStorageReference, evidence.ivBase64, evidence.authTagBase64);

    await writeAudit({ action: "EVIDENCE_VIEWED", adminId: admin.id, meta: { caseId: evidence.caseId, evidenceId: id } });
    await prisma.caseAccessLog.create({ data: { caseId: evidence.caseId, adminId: admin.id, action: "EVIDENCE_VIEWED" } });

    return new NextResponse(new Uint8Array(bytes), {
      headers: { "Content-Type": evidence.mimeType, "Cache-Control": "no-store", "Content-Disposition": contentDisposition(evidence.originalFilename ?? "evidence"), "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
