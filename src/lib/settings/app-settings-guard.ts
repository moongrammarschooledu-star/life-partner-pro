import { z } from "zod";
import { AdminRole } from "@prisma/client";

// Allow-list for PATCH /api/admin/settings. That route used to hand the whole request body to `appSettings.upsert`, so anyone holding
// `settings:edit` could also write the payment rollout stage, the master payment switches or the active payment provider (all of which have
// their own routes, permissions, re-authentication and approvals), or any column that happens to exist. Now:
//   * the page sends the whole row back, so keys that are protected or unknown are DROPPED when they equal the stored value (harmless round-trip),
//   * a protected key with a DIFFERENT value is refused with an error that names where it is managed,
//   * every editable key is validated with its own range.

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const weight = int(0, 100);
const tier = int(0, 100);
const hours = int(1, 720);



// Bucket definitions for reports: small arrays of plain objects, size-capped so a request cannot store an arbitrary document.
const bucketList = z
  .array(z.record(z.string().max(60), z.union([z.string().max(120), z.number(), z.boolean(), z.null(), z.array(z.string().max(120)).max(50)])))
  .max(50)
  .refine((v) => JSON.stringify(v).length <= 20_000, "Too large")
  .nullable();

export const EDITABLE_APP_SETTINGS = {
  appName: z.string().trim().min(1).max(80),
  contactEmail: optionalText(200),
  contactWhatsapp: optionalText(40),
  contactAddress: optionalText(300),

  weightAge: weight, weightLocation: weight, weightEducation: weight, weightProfession: weight, weightIncome: weight, weightMaritalStatus: weight,
  weightHeight: weight, weightFamily: weight, weightReligious: weight, weightLifestyle: weight, weightLanguages: weight,
  thresholdExcellent: tier, thresholdVeryGood: tier, thresholdGood: tier, thresholdPossible: tier,

  hardRequirementAge: z.boolean(), hardRequirementLocation: z.boolean(), hardRequirementEducation: z.boolean(), hardRequirementProfession: z.boolean(),
  hardRequirementIncome: z.boolean(), hardRequirementMaritalStatus: z.boolean(), hardRequirementHeight: z.boolean(), hardRequirementFamily: z.boolean(),
  hardRequirementReligious: z.boolean(), hardRequirementLifestyle: z.boolean(), hardRequirementLanguages: z.boolean(),
  categoryEnabledAge: z.boolean(), categoryEnabledLocation: z.boolean(), categoryEnabledEducation: z.boolean(), categoryEnabledProfession: z.boolean(),
  categoryEnabledIncome: z.boolean(), categoryEnabledMaritalStatus: z.boolean(), categoryEnabledHeight: z.boolean(), categoryEnabledFamily: z.boolean(),
  categoryEnabledReligious: z.boolean(), categoryEnabledLifestyle: z.boolean(), categoryEnabledLanguages: z.boolean(),
  maxMatchResults: int(1, 100),
  excludeHardRequirementFailures: z.boolean(),

  documentVerificationEnabled: z.boolean(),
  acceptedDocumentTypes: z.string().max(400).nullable(),
  allowPartiallyVerifiedManualMatch: z.boolean(),
  removeFromPoolDuringReVerification: z.boolean(),
  autoReVerificationOnKeyFieldChange: z.boolean(),
  otpExpiryMinutes: int(1, 60),
  otpMaxAttempts: int(1, 10),

  emailNotificationsEnabled: z.boolean(), smsNotificationsEnabled: z.boolean(), whatsappNotificationsEnabled: z.boolean(), inAppNotificationsEnabled: z.boolean(),
  defaultNotificationLanguage: z.enum(["EN", "UR"]),
  meetingReminder24hEnabled: z.boolean(), meetingReminder2hEnabled: z.boolean(), followUpReminderEnabled: z.boolean(),
  pendingProposalReminderDays: int(1, 30),
  notificationRetryLimit: int(0, 10),
  quietHoursStart: int(0, 23).nullable(), quietHoursEnd: int(0, 23).nullable(),

  ageRangeBuckets: bucketList, incomeRangeBuckets: bucketList, professionCategories: bucketList,

  // Security fields (also need a fresh password re-confirmation; see SECURITY_FIELDS in the route).
  loginMaxAttempts: int(1, 20),
  loginLockoutMinutes: int(1, 1440),
  twoFactorRequiredRoles: z.array(z.enum(AdminRole)).max(20).nullable(),
  passwordMinLength: int(8, 128),

  caseSlaNormalFirstResponseHours: hours, caseSlaNormalResolutionHours: hours, caseSlaHighFirstResponseHours: hours, caseSlaHighResolutionHours: hours,
  caseSlaUrgentFirstResponseHours: hours, caseSlaUrgentResolutionHours: hours, caseSlaCriticalFirstResponseHours: hours, caseSlaCriticalResolutionHours: hours,
} as const;

export type EditableAppSettingKey = keyof typeof EDITABLE_APP_SETTINGS;

/** Payment, rollout, membership kill-switch and reconciliation settings: each has its own route, permission, re-authentication and approval. */
export const PROTECTED_APP_SETTINGS: Record<string, string> = {
  activePaymentProvider: "Finance Center → Rollout", defaultCurrencyCode: "Finance Center", subscriptionGracePeriodDays: "Finance Center", paymentRetryLimit: "Finance Center",
  refundApprovalRequiredAboveMinorUnits: "Finance Center", paidFeatureKeys: "Membership", paymentRolloutStage: "Finance Center → Rollout (approval required)",
  paymentsEnabled: "Finance Center → Rollout flags", checkoutEnabled: "Finance Center → Rollout flags", subscriptionsEnabled: "Finance Center → Rollout flags",
  refundsEnabled: "Finance Center → Rollout flags", manualPaymentEnabled: "Finance Center → Rollout flags", betaEnabled: "Finance Center → Rollout flags",
  publicCheckoutEnabled: "Finance Center → Rollout flags", providerWebhooksEnabled: "Finance Center → Rollout flags", renewalsEnabled: "Membership",
  couponsEnabled: "Membership", referralsEnabled: "Membership", promotionsEnabled: "Membership", creditsEnabled: "Membership",
  paymentBetaPercentage: "Finance Center → Rollout", paymentBetaAllowedProfileIds: "Finance Center → Rollout", paymentBetaAllowedCountries: "Finance Center → Rollout",
  paymentBetaAllowedPackageIds: "Finance Center → Rollout", paymentInternalAllowedProfileIds: "Finance Center → Rollout", reconciliationFrequency: "Finance Center → Reconciliation",
  lastScheduledReconciliationAt: "the reconciliation job",
};

export const SECURITY_APP_SETTINGS = ["loginMaxAttempts", "loginLockoutMinutes", "twoFactorRequiredRoles", "passwordMinLength"] as const;

// Round-trip keys the settings page always sends back that are not settings at all.
const ROW_METADATA = new Set(["id", "updatedAt"]);

export type SanitisedPatch = { ok: true; data: Record<string, unknown>; ignored: string[] } | { ok: false; status: 400 | 403; error: string };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** `current` is the stored row. Returns only validated, allow-listed changes (values equal to the stored ones are dropped). */
export function sanitiseAppSettingsPatch(body: Record<string, unknown>, current: Record<string, unknown>): SanitisedPatch {
  const data: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (ROW_METADATA.has(key)) continue;
    if (key in PROTECTED_APP_SETTINGS) {
      const stored = current[key];
      const unchanged = key.endsWith("At") ? same(value ? new Date(String(value)).toISOString() : null, stored instanceof Date ? stored.toISOString() : stored) : same(value, stored);
      if (!unchanged) return { ok: false, status: 403, error: `“${key}” is not changed here. It is managed in ${PROTECTED_APP_SETTINGS[key]}.` };
      continue;
    }
    const schema = (EDITABLE_APP_SETTINGS as Record<string, z.ZodTypeAny>)[key];
    if (!schema) {
      // Unknown keys are never written. A value equal to nothing stored is simply ignored; a key that does not exist at all is reported.
      if (key in current) ignored.push(key);
      else return { ok: false, status: 400, error: `Unknown setting “${key.slice(0, 40)}”.` };
      continue;
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) return { ok: false, status: 400, error: `${key}: ${parsed.error.issues[0]?.message ?? "invalid value"}` };
    if (!same(parsed.data, current[key])) data[key] = parsed.data;
  }

  // Cross-field rules, checked on the values the row would have after the change.
  const merged = { ...current, ...data } as Record<string, number>;
  if (!(merged.thresholdExcellent > merged.thresholdVeryGood && merged.thresholdVeryGood > merged.thresholdGood && merged.thresholdGood > merged.thresholdPossible)) {
    return { ok: false, status: 400, error: "Match tiers must stay strictly descending: Excellent > Very good > Good > Possible." };
  }
  if (merged.quietHoursStart != null && merged.quietHoursEnd != null && merged.quietHoursStart === merged.quietHoursEnd) {
    return { ok: false, status: 400, error: "Quiet hours must start and end at different hours." };
  }
  return { ok: true, data, ignored };
}

/** Effective percentages the matching engine uses: weights of the enabled categories, normalised to 100 (so any positive set of weights is safe). */
export const WEIGHT_CATEGORIES = ["Age", "Location", "Education", "Profession", "Income", "MaritalStatus", "Height", "Family", "Religious", "Lifestyle", "Languages"] as const;

export function effectiveWeights(settings: Record<string, unknown>): { category: string; weight: number; enabled: boolean; percent: number }[] {
  const rows = WEIGHT_CATEGORIES.map((c) => ({ category: c, weight: Number(settings[`weight${c}`] ?? 0), enabled: settings[`categoryEnabled${c}`] !== false }));
  const active = rows.filter((r) => r.enabled && r.weight > 0);
  const total = active.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return rows.map((r) => ({ ...r, percent: 0 }));
  // Largest-remainder rounding in hundredths of a percent, so the shown percentages add up to exactly 100.
  const raw = active.map((r) => ({ category: r.category, units: (r.weight / total) * 10_000 }));
  const floors = raw.map((r) => ({ category: r.category, units: Math.floor(r.units), frac: r.units - Math.floor(r.units) }));
  let left = 10_000 - floors.reduce((s, r) => s + r.units, 0);
  for (const r of [...floors].sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    r.units += 1;
    left -= 1;
  }
  const percentOf = new Map(floors.map((r) => [r.category, r.units / 100]));
  return rows.map((r) => ({ ...r, percent: percentOf.get(r.category) ?? 0 }));
}
export function matchingConfigProblems(settings: Record<string, unknown>): string[] {
  const rows = effectiveWeights(settings);
  const problems: string[] = [];
  if (rows.filter((r) => r.enabled && r.weight > 0).length === 0) problems.push("No enabled category has a weight: no profile could be scored.");
  const total = rows.reduce((s, r) => s + r.percent, 0);
  if (rows.some((r) => r.enabled && r.weight > 0) && Math.abs(total - 100) > 0.001) problems.push(`Effective weights total ${total}%, expected 100%.`);
  return problems;
}
