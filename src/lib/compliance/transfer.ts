import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isCrossBorderTransferAllowed } from "@/lib/compliance/rule-engine";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifyAdmins } from "@/lib/notifications/notification-service";
import type { DataClassification, TransferStatus } from "@prisma/client";

export interface AssessTransferInput {
  sourceJurisdictionId?: string;
  destJurisdictionId?: string;
  destJurisdictionCode?: string; // used to look up a CROSS_BORDER_TRANSFER rule even without a resolved dest Jurisdiction row
  dataClass: DataClassification;
  dataType: string;
  purpose: string;
  provider?: string;
  storageLocation?: string;
  transferMechanism?: string;
  userConsentRequired?: boolean;
  userConsentObtained?: boolean;
  contractualControls?: string;
  assessedById?: string;
}

// CrossBorderTransferService (spec §19) — a real, persisted decision record
// every time, never just a function return. UNKNOWN/REVIEW_REQUIRED is the
// conservative default whenever no ComplianceRule resolves the pair — never
// ALLOWED (spec: "do not default to unrestricted transfer").
export async function assessTransfer(input: AssessTransferInput) {
  let status: TransferStatus = "UNKNOWN";
  let governingRuleId: string | null = null;

  if (input.sourceJurisdictionId && input.destJurisdictionCode) {
    const ruleResult = await isCrossBorderTransferAllowed(input.sourceJurisdictionId, input.destJurisdictionCode);
    if (ruleResult.resolved && ruleResult.value) {
      status = ruleResult.value.status;
      governingRuleId = ruleResult.matchedRules[0]?.id ?? null;
      // A rule permitting the transfer still requires consent to actually be
      // in hand when the rule itself demands it — never silently ALLOWED.
      if (status === "ALLOWED" && input.userConsentRequired && !input.userConsentObtained) {
        status = "REVIEW_REQUIRED";
      }
    } else {
      status = "REVIEW_REQUIRED";
    }
  } else {
    // Missing source/destination context entirely — cannot even attempt a
    // rule lookup, so this is UNKNOWN rather than REVIEW_REQUIRED (a
    // slightly weaker signal: we don't yet have enough to know what to review).
    status = "UNKNOWN";
  }

  const assessment = await prisma.dataTransferAssessment.create({
    data: {
      assessmentCode: await nextSequenceCode("XFER"),
      sourceJurisdictionId: input.sourceJurisdictionId ?? null,
      destJurisdictionId: input.destJurisdictionId ?? null,
      dataClass: input.dataClass,
      dataType: input.dataType,
      purpose: input.purpose,
      provider: input.provider ?? null,
      storageLocation: input.storageLocation ?? null,
      transferMechanism: input.transferMechanism ?? null,
      userConsentRequired: input.userConsentRequired ?? false,
      userConsentObtained: input.userConsentObtained ?? false,
      contractualControls: input.contractualControls ?? null,
      governingRuleId,
      status,
      assessedById: input.assessedById ?? null,
    },
  });

  await writeAudit({
    action: status === "BLOCKED" ? "TRANSFER_BLOCKED" : "TRANSFER_ASSESSED",
    adminId: input.assessedById,
    meta: { assessmentId: assessment.id, assessmentCode: assessment.assessmentCode, status, dataClass: input.dataClass, dataType: input.dataType },
  });

  // A TRANSFER_REVIEW task/notification IS created for a non-ALLOWED outcome,
  // but deduplicated once per day per (provider, destination) pair rather
  // than once per assessment — this function is called on every
  // verification-provider session (best-effort, non-blocking), and
  // REVIEW_REQUIRED/UNKNOWN is the default outcome until jurisdictions are
  // actually configured, so a per-assessment task would flood the queue.
  // The dedup key, not a separate "already notified" flag, is what prevents
  // the flood — createFromEvent's unique constraint on WorkflowEvent.dedupKey
  // silently no-ops a repeat within the same day.
  if (status !== "ALLOWED") {
    const day = new Date().toISOString().slice(0, 10);
    const bucket = `${input.provider ?? "unknown-provider"}:${input.destJurisdictionCode ?? "unknown-destination"}`;
    await createFromEvent({
      eventName: status === "UNKNOWN" ? "TRANSFER_JURISDICTION_UNKNOWN" : "TRANSFER_REVIEW_REQUIRED",
      dedupKey: `${status === "UNKNOWN" ? "JURISDICTION_UNKNOWN" : "TRANSFER_REVIEW"}:${bucket}:${day}`,
      resourceType: "CASE",
      resourceId: assessment.id,
      taskType: status === "UNKNOWN" ? "JURISDICTION_REVIEW" : "TRANSFER_REVIEW",
      priority: status === "BLOCKED" ? "HIGH" : "NORMAL",
      title: status === "UNKNOWN" ? "Cross-border transfer: jurisdiction could not be resolved" : "Cross-border transfer needs compliance review",
      description: `Provider: ${input.provider ?? "n/a"}, destination: ${input.destJurisdictionCode ?? "n/a"}, status: ${status}`,
    });
    await notifyAdmins({
      type: status === "UNKNOWN" ? "COMPLIANCE_JURISDICTION_UNKNOWN" : "COMPLIANCE_TRANSFER_REVIEW_REQUIRED",
      data: { templateVars: { assessmentCode: assessment.assessmentCode, status } },
      roles: ["COMPLIANCE_MANAGER"],
    });
  }

  return assessment;
}
