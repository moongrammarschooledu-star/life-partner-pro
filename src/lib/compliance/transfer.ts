import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { isCrossBorderTransferAllowed } from "@/lib/compliance/rule-engine";
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

  // Deliberately does NOT auto-create a TRANSFER_REVIEW AdminTask here: this
  // function is called on every verification-provider session (best-effort,
  // non-blocking — src/lib/verification/provider/session.ts), and
  // REVIEW_REQUIRED/UNKNOWN is the default outcome until jurisdictions are
  // actually configured. Auto-dispatching a task per assessment would flood
  // the task queue long before any admin has set up a single Jurisdiction
  // row. The Compliance dashboard/reviews pages already surface the
  // aggregate "transfers needing review" count; TRANSFER_REVIEW remains
  // available for a future, more targeted trigger (e.g. only once per
  // distinct provider/jurisdiction pair) rather than one per assessment.
  return assessment;
}
