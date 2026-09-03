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
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? "default"}>{formatEnumLabel(status)}</Badge>;
}
