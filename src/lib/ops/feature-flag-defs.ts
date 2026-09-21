// Registry of feature flags that have a REAL server-side consumer (spec §28).
// Flags without a consumer (e.g. ai_matching, new_dashboard) are deliberately
// not registered — a switch that controls nothing would be misleading.
// `payments.enabled` is a read-only alias of the existing payment-rollout
// master switch (AppSettings.paymentsEnabled) — one source of truth.

export interface FeatureFlagDef {
  key: string;
  description: string;
  sensitive: boolean;
  managedElsewhere?: string;
}

export const FEATURE_FLAG_DEFS: FeatureFlagDef[] = [
  { key: "matching.enabled", description: "Admin matching runs and match creation", sensitive: true },
  { key: "proposals.enabled", description: "Creating new proposals", sensitive: true },
  { key: "verification.enabled", description: "Applicant verification submissions (OTP + documents)", sensitive: true },
  { key: "notifications.enabled", description: "Sending notifications on every channel", sensitive: true },
  { key: "whatsapp.enabled", description: "WhatsApp notification channel", sensitive: false },
  { key: "support.enabled", description: "New support / complaint / safety cases from applicants", sensitive: false },
  { key: "registrations.enabled", description: "New applicant registrations", sensitive: true },
  { key: "uploads.enabled", description: "File uploads (photos, documents, evidence)", sensitive: true },
  { key: "payments.enabled", description: "Payments master switch", sensitive: true, managedElsewhere: "Finance Center → Rollout" },
  // STEP 16 — AI Assistant. Every flag defaults to OFF (see FEATURE_FLAG_DEFAULTS) and the rollout phase in AiConfig must also allow use.
  { key: "ai.enabled", description: "AI Matchmaking Assistant master switch (also requires a rollout phase above DISABLED)", sensitive: true },
  { key: "ai.profile_summary.enabled", description: "AI profile summary", sensitive: true },
  { key: "ai.match_explanation.enabled", description: "AI match explanation and mutual requirement analysis", sensitive: true },
  { key: "ai.compare.enabled", description: "AI candidate comparison (no ranking)", sensitive: true },
  { key: "ai.proposal_assistant.enabled", description: "AI proposal preparation summary", sensitive: true },
  { key: "ai.communication_assistant.enabled", description: "AI message drafting (never sends)", sensitive: true },
  { key: "ai.followup_assistant.enabled", description: "AI follow-up suggestions and drafts (never sends)", sensitive: true },
  { key: "ai.copilot.enabled", description: "Admin Copilot", sensitive: true },
  { key: "ai.report_assistant.enabled", description: "AI report summaries (numbers come from existing reports only)", sensitive: true },
];

// AI flags default to OFF: a database hiccup or a fresh install must never switch AI on.
export const FEATURE_FLAG_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURE_FLAG_DEFS.map((d) => [d.key, !d.key.startsWith("ai.")]));

export function isKnownFeatureFlag(key: string): boolean {
  return FEATURE_FLAG_DEFS.some((d) => d.key === key && !d.managedElsewhere);
}
