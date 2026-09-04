import type { ProposalResponseType, ProposalStatus } from "@prisma/client";
import type { CategoryResult } from "@/lib/matching";

type MinimalCategoryResult = Pick<CategoryResult, "category" | "status">;

export type ResponseOrNull = ProposalResponseType | null | undefined;

// Pure state-transition logic (no DB) — given the current status and the
// latest response recorded for each side, returns the next status. A
// one-sided NOT_INTERESTED ends the proposal outright: in this domain a
// single decline conventionally closes that specific rishta (an admin can
// still reopen it via Change Status). Statuses reached only through
// dedicated admin actions (contact/meeting/finalize/married/etc.) are
// intentionally NOT produced here — this only covers the interest-response
// portion of the lifecycle (spec §6/§7).
export function nextProposalStatus(current: ProposalStatus, responseA: ResponseOrNull, responseB: ResponseOrNull): ProposalStatus {
  if (responseA === "NOT_INTERESTED" || responseB === "NOT_INTERESTED") {
    return "REJECTED";
  }
  if (responseA === "INTERESTED" && responseB === "INTERESTED") {
    return "BOTH_INTERESTED";
  }
  if (responseA === "INTERESTED" && !responseB) {
    return "WAITING_FOR_PROFILE_B";
  }
  if (responseB === "INTERESTED" && !responseA) {
    return "WAITING_FOR_PROFILE_A";
  }
  if (responseA === "INTERESTED" && responseB === "NEED_MORE_INFO") {
    return "PROFILE_A_INTERESTED";
  }
  if (responseB === "INTERESTED" && responseA === "NEED_MORE_INFO") {
    return "PROFILE_B_INTERESTED";
  }
  if (responseA === "NEED_MORE_INFO" || responseB === "NEED_MORE_INFO") {
    return "BOTH_REVIEWING";
  }
  // No response yet on either side — leave whatever pre-response status the
  // proposal is already in untouched (e.g. PROPOSAL_CREATED).
  return current;
}

// Plain-language, admin-note-free sentences derived only from category +
// status — never the raw admin `reason` text, which can reference internal
// scoring language not meant for an applicant audience (spec §5/§26).
const HIGHLIGHT_TEMPLATES: Record<string, string> = {
  age: "Ages are well matched.",
  location: "Locations are a good match.",
  education: "Education backgrounds align well.",
  profession: "Professional backgrounds align well.",
  income: "Income expectations are compatible.",
  maritalStatus: "Marital status preferences match.",
  height: "Height preferences are compatible.",
  family: "Family backgrounds are compatible.",
  religious: "Religious preferences are compatible.",
  lifestyle: "Lifestyles are compatible.",
  languages: "Shared languages in common.",
};

const DIFFERENCE_TEMPLATES: Record<string, string> = {
  age: "Age difference is outside the usual preference.",
  location: "Locations are farther apart than preferred.",
  education: "Education backgrounds differ from stated preferences.",
  profession: "Professional backgrounds differ from stated preferences.",
  income: "Income expectations differ from stated preferences.",
  maritalStatus: "Marital status differs from stated preferences.",
  height: "Height differs from stated preferences.",
  family: "Family background differs from stated preferences.",
  religious: "Religious preferences differ.",
  lifestyle: "Lifestyle preferences differ.",
  languages: "No shared languages listed.",
};

export interface ApplicantHighlights {
  highlights: string[];
  differences: string[];
}

export function deriveApplicantHighlights(breakdown: MinimalCategoryResult[]): ApplicantHighlights {
  const highlights: string[] = [];
  const differences: string[] = [];
  for (const part of breakdown) {
    if (part.status === "compatible" && HIGHLIGHT_TEMPLATES[part.category]) {
      highlights.push(HIGHLIGHT_TEMPLATES[part.category]);
    } else if ((part.status === "incompatible" || part.status === "partial") && DIFFERENCE_TEMPLATES[part.category]) {
      differences.push(DIFFERENCE_TEMPLATES[part.category]);
    }
  }
  return { highlights, differences };
}
