"use client";

import { Badge } from "@/components/ui/badge";
import { formatEnumLabel } from "@/lib/utils";

// Shared bits for the Risk & Safety Center screens. Wording rule for every screen here: a level or a signal is an
// INDICATOR that asks for human review - never a finding about a person.

export const LEVEL_VARIANT: Record<string, "danger" | "warning" | "info" | "muted"> = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

export function LevelBadge({ level }: { level: string }) {
  return <Badge variant={LEVEL_VARIANT[level] ?? "muted"}>{formatEnumLabel(level)}</Badge>;
}

export function HumanReviewNotice() {
  return (
    <p className="rounded-lg border border-info/30 bg-info/5 p-3 text-xs text-muted">
      Levels and signals are indicators that ask for a human review. They are not findings about a person, they can have innocent explanations, and any restriction or suspension needs a completed review checklist and approval.
    </p>
  );
}

export const RESTRICTION_CHOICES: Array<{ value: string; label: string }> = [
  { value: "MATCHING", label: "Matching" },
  { value: "PROPOSALS", label: "Proposals" },
  { value: "CONTACT", label: "Contact sharing" },
  { value: "MEETINGS", label: "Meetings" },
  { value: "PROFILE_EDITS", label: "Profile edits" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "PAYMENT", label: "Payment" },
  { value: "FAMILY_ACCESS", label: "Family access" },
  { value: "FAMILY_INVITATIONS", label: "Family invitations" },
  { value: "VERIFICATION_REQUIRED", label: "Verification required" },
  { value: "LOGIN", label: "Login" },
  { value: "FULL_ACCOUNT", label: "Full account" },
];

export const FALSE_POSITIVE_CHOICES: Array<{ value: string; label: string }> = [
  { value: "SHARED_FAMILY_DEVICE", label: "Shared family device" },
  { value: "SHARED_FAMILY_PHONE", label: "Shared family phone" },
  { value: "SHARED_HOME_NETWORK", label: "Shared home network" },
  { value: "DATA_ENTRY_ERROR", label: "Data-entry mistake" },
  { value: "PROVIDER_ERROR", label: "Provider error" },
  { value: "LEGITIMATE_DUPLICATE_CONTEXT", label: "Legitimate duplicate context" },
  { value: "INCORRECT_SIGNAL", label: "Signal was incorrect" },
  { value: "OTHER", label: "Other" },
];

export const CHECKLIST_ITEMS: Array<{ key: string; label: string }> = [
  { key: "evidenceReviewed", label: "I reviewed the evidence and signals for this case" },
  { key: "falsePositivesConsidered", label: "I considered innocent explanations (shared device or phone, travel, data-entry mistakes)" },
  { key: "lessRestrictiveOptionConsidered", label: "I considered a less restrictive option (information request, re-verification)" },
];
