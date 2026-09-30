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
  { key: "communications.campaigns.enabled", description: "Bulk communication campaigns (defaults OFF; also requires marketing consent and an active jurisdiction rule)", sensitive: true },
  { key: "communications.marketing.enabled", description: "Marketing messages on any channel (defaults OFF; never implied by registration)", sensitive: true },
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
  { key: "ai.compliance_summary.enabled", description: "AI compliance configuration summary (read-only; human legal review required)", sensitive: true },
  { key: "ai.risk_summary.enabled", description: "AI risk-case summary (read-only; never concludes guilt or decides an action; human review required)", sensitive: true },
  { key: "ai.crm_summary.enabled", description: "AI CRM applicant/timeline summary (read-only metadata only; never decides the next lifecycle step; human review required)", sensitive: true },
  // STEP 26 — document management. OCR defaults OFF: no OCR vendor is configured (see the NoopOcrProvider);
  // turning this on alone changes nothing until a real provider is also configured.
  { key: "documents.ocr.enabled", description: "OCR-assisted document processing (output is always unverified, pending human review)", sensitive: true },
  // STEP 27 — membership/entitlements. "packages.enabled" is deliberately NOT
  // registered here: disabling a specific package is already covered by
  // Package.status = INACTIVE, and there is no separate "all packages" master
  // switch to alias — a flag with no real consumer would be misleading (see
  // the file header). subscriptions/coupons alias the existing/new AppSettings
  // booleans (same one-source-of-truth pattern as payments.enabled); referrals/
  // promotions/credits are genuinely independent switches.
  { key: "subscriptions.enabled", description: "New subscription checkouts (existing subscriptions unaffected)", sensitive: true, managedElsewhere: "Finance Center → Rollout" },
  { key: "coupons.enabled", description: "Coupon validation and redemption at checkout", sensitive: true, managedElsewhere: "Finance Center → Rollout" },
  { key: "referrals.enabled", description: "Referral code generation, linking, and reward granting", sensitive: true, managedElsewhere: "Finance Center → Rollout" },
  { key: "promotions.enabled", description: "Promotional campaign eligibility and application at checkout", sensitive: true, managedElsewhere: "Finance Center → Rollout" },
  { key: "credits.enabled", description: "Membership credit grants and use at checkout", sensitive: true, managedElsewhere: "Finance Center → Rollout" },
];

// AI/OCR flags default to OFF: a database hiccup or a fresh install must never switch them on.
export const FEATURE_FLAG_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURE_FLAG_DEFS.map((d) => [d.key, !d.key.startsWith("ai.") && !d.key.startsWith("communications.") && d.key !== "documents.ocr.enabled"]));

export function isKnownFeatureFlag(key: string): boolean {
  return FEATURE_FLAG_DEFS.some((d) => d.key === key && !d.managedElsewhere);
}
