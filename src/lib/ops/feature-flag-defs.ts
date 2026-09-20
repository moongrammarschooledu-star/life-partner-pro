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
];

export const FEATURE_FLAG_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURE_FLAG_DEFS.map((d) => [d.key, true]));

export function isKnownFeatureFlag(key: string): boolean {
  return FEATURE_FLAG_DEFS.some((d) => d.key === key && !d.managedElsewhere);
}
