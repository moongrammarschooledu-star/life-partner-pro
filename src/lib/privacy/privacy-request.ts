import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { revokeConsent } from "@/lib/privacy/consent";
import { submitDeletionRequest } from "@/lib/privacy/deletion-request";
import { createDataExport } from "@/lib/privacy/data-export";
import { nextCaseNumber } from "@/lib/case-code";
import { createFromEvent } from "@/lib/workflow/engine";
import type { PrivacyRequestType, ConsentCategory } from "@prisma/client";

// Spec §22 — a thin router (LPP-PRIV-######), not 8 separate systems. Types
// with a dedicated flow trigger it AND get a tracking row linked to the
// underlying record; types with no dedicated flow use this row as the
// primary record.
export async function submitPrivacyRequest(params: {
  profileId: string;
  type: PrivacyRequestType;
  description?: string;
  consentCategory?: ConsentCategory; // required for WITHDRAW_CONSENT
}) {
  const requestCode = await nextSequenceCode("PRIV");

  let linkedRecordType: string | null = null;
  let linkedRecordId: string | null = null;
  let status: "SUBMITTED" | "IN_PROGRESS" = "SUBMITTED";

  if (params.type === "DELETION") {
    const deletion = await submitDeletionRequest(params.profileId, params.description);
    linkedRecordType = "AccountDeletionRequest";
    linkedRecordId = deletion.id;
  } else if (params.type === "EXPORT") {
    const exportReq = await createDataExport(params.profileId);
    linkedRecordType = "DataExportRequest";
    linkedRecordId = exportReq.id;
    status = "IN_PROGRESS";
  } else if (params.type === "WITHDRAW_CONSENT" && params.consentCategory) {
    const grant = await revokeConsent(params.profileId, params.consentCategory, "PRIVACY_REQUEST_CENTER");
    linkedRecordType = "ConsentGrant";
    linkedRecordId = grant.id;
    status = "IN_PROGRESS";
  } else if (params.type === "REPORT_ISSUE") {
    const caseNumber = await nextCaseNumber("PRIVACY_INCIDENT");
    const created = await prisma.case.create({
      data: {
        caseNumber,
        type: "PRIVACY_INCIDENT",
        category: "OTHER_PRIVACY_INCIDENT",
        subject: "Privacy issue reported via Privacy Request Center",
        description: params.description ?? "No further details provided.",
        reporterProfileId: params.profileId,
      },
    });
    linkedRecordType = "Case";
    linkedRecordId = created.id;
  }

  const request = await prisma.privacyRequest.create({
    data: {
      requestCode,
      profileId: params.profileId,
      type: params.type,
      status,
      description: params.description ?? null,
      linkedRecordType,
      linkedRecordId,
    },
  });

  await writeAudit({ action: "PRIVACY_REQUEST_CREATED", targetProfileId: params.profileId, meta: { requestId: request.id, requestCode, type: params.type } });

  // STEP 18 §35 — privacy requests previously just sat in a list with no
  // task/notification loop pushing an admin to act. A REPORT_ISSUE request
  // already becomes a Case above — wrap that (reusing its real per-record
  // ACL) rather than the weaker permission-only PRIVACY_REQUEST gate;
  // every other type gets a task pointed at the PrivacyRequest itself.
  await createFromEvent({
    eventName: "PRIVACY_REQUEST_CREATED",
    dedupKey: `PRIVACY_REQUEST_CREATED:${request.id}`,
    resourceType: linkedRecordType === "Case" ? "CASE" : "PRIVACY_REQUEST",
    resourceId: linkedRecordType === "Case" && linkedRecordId ? linkedRecordId : request.id,
    taskType: params.type === "DELETION" ? "DELETION_REQUEST_TASK" : "PRIVACY_REQUEST_TASK",
    title: `Privacy request ${requestCode} (${params.type})`,
  });

  return request;
}

export async function resolvePrivacyRequest(params: {
  requestId: string;
  adminId: string;
  status: "UNDER_REVIEW" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED";
  resolutionNote?: string;
}) {
  const request = await prisma.privacyRequest.update({
    where: { id: params.requestId },
    data: {
      status: params.status,
      handledById: params.adminId,
      resolutionNote: params.resolutionNote ?? null,
      resolvedAt: ["COMPLETED", "REJECTED", "CANCELLED"].includes(params.status) ? new Date() : null,
    },
  });
  return request;
}
