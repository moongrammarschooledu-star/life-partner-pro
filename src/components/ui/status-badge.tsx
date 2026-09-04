import { Badge } from "@/components/ui/badge";
import { formatEnumLabel } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "info" | "muted"> = {
  NEW: "info",
  UNDER_REVIEW: "warning",
  VERIFIED: "success",
  ACTIVE: "success",
  MATCHING: "default",
  PROPOSAL_SENT: "default",
  WAITING_FOR_RESPONSE: "warning",
  INTERESTED: "success",
  NOT_INTERESTED: "muted",
  MEETING_ARRANGED: "info",
  FINALIZED: "success",
  MARRIED: "success",
  REJECTED: "danger",
  ARCHIVED: "muted",

  // Proposal lifecycle statuses (STEP 7) — reuses this same badge/map so
  // both Profile and Proposal statuses render consistently.
  DRAFT: "muted",
  PROPOSAL_CREATED: "info",
  WAITING_FOR_PROFILE_A: "warning",
  WAITING_FOR_PROFILE_B: "warning",
  BOTH_REVIEWING: "warning",
  PROFILE_A_INTERESTED: "info",
  PROFILE_B_INTERESTED: "info",
  BOTH_INTERESTED: "success",
  CONTACT_PERMISSION_PENDING: "warning",
  CONTACT_APPROVED: "success",
  FAMILIES_CONTACTED: "info",
  MEETING_REQUESTED: "warning",
  MEETING_SCHEDULED: "info",
  MEETING_COMPLETED: "success",
  FURTHER_DISCUSSION: "warning",
  ACCEPTED: "success",
  ON_HOLD: "muted",
  CLOSED: "muted",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "default"}>{formatEnumLabel(status)}</Badge>;
}
