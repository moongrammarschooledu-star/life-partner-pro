import { prisma } from "@/lib/prisma";
import { getAllFeatureFlags } from "@/lib/ops/feature-flags";
import { getSystemControl } from "@/lib/ops/system-control";
import { effectiveWeights, matchingConfigProblems } from "@/lib/settings/app-settings-guard";

// Read-only summaries for the section hubs (STEP 36 §22–§47): the CURRENT configuration of an area, taken from that area's own tables, with nothing to edit
// here. Each row is a label and a value (a number, a word, or a short text). A figure that cannot be read is omitted, never invented.

export interface SummaryRow {
  label: string;
  value: string | number | boolean | null;
}
export interface SectionSummary {
  rows: SummaryRow[];
  problems: string[];
  /** A table of rows (for example the normalised matching weights), when a list reads better than single figures. */
  table?: { columns: string[]; rows: Array<Array<string | number>> };
}

const onOff = (v: unknown) => (v ? "On" : "Off");
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function getSectionSummary(key: string): Promise<SectionSummary | null> {
  const settings = await safe(() => prisma.appSettings.findUnique({ where: { id: 1 } }));
  const flags = await safe(() => getAllFeatureFlags());
  const flag = (k: string) => (flags ? onOff(flags[k] ?? true) : null);
  const rows: SummaryRow[] = [];
  const problems: string[] = [];

  switch (key) {
    case "matching": {
      if (!settings) return null;
      const weights = effectiveWeights(settings as unknown as Record<string, unknown>);
      problems.push(...matchingConfigProblems(settings as unknown as Record<string, unknown>));
      const hard = Object.entries(settings).filter(([k, v]) => k.startsWith("hardRequirement") && v === true).length;
      rows.push({ label: "Match tiers (Excellent / Very good / Good / Possible)", value: `${settings.thresholdExcellent} / ${settings.thresholdVeryGood} / ${settings.thresholdGood} / ${settings.thresholdPossible}` });
      rows.push({ label: "Most results shown", value: settings.maxMatchResults });
      rows.push({ label: "Categories treated as hard requirements", value: hard });
      rows.push({ label: "Exclude candidates that fail a hard requirement", value: onOff(settings.excludeHardRequirementFailures) });
      rows.push({ label: "Matching engine switch", value: flag("matching.enabled") });
      rows.push({ label: "Scoring inputs", value: "Fixed set of profile fields. There is no attractiveness, facial, sensitive-trait or marriage-outcome score." });
      return { rows, problems, table: { columns: ["Category", "Weight", "Enabled", "Effective share"], rows: weights.map((w) => [w.category, w.weight, w.enabled ? "Yes" : "No", `${w.percent}%`]) } };
    }
    case "verification": {
      const policies = await safe(() => prisma.verificationPolicy.count());
      rows.push({ label: "Verification policies", value: policies });
      if (settings) {
        rows.push({ label: "Document verification", value: onOff(settings.documentVerificationEnabled) });
        rows.push({ label: "Re-verification when key details change", value: onOff(settings.autoReVerificationOnKeyFieldChange) });
        rows.push({ label: "One-time code lifetime (minutes) / attempts", value: `${settings.otpExpiryMinutes} / ${settings.otpMaxAttempts}` });
      }
      rows.push({ label: "Verification switch", value: flag("verification.enabled") });
      return { rows, problems };
    }
    case "communication":
    case "notifications": {
      const providers = await safe(() => prisma.communicationProvider.findMany({ select: { channel: true, active: true, healthStatus: true } }));
      if (providers) for (const ch of ["EMAIL", "SMS", "WHATSAPP"]) {
        const list = providers.filter((p) => p.channel === ch);
        rows.push({ label: `${ch} providers (active / total)`, value: `${list.filter((p) => p.active).length} / ${list.length}` });
      }
      rows.push({ label: "E-mail / SMS / WhatsApp switches", value: `${flag("email.enabled")} / ${flag("sms.enabled")} / ${flag("whatsapp.enabled")}` });
      if (settings) {
        rows.push({ label: "Quiet hours", value: settings.quietHoursStart != null && settings.quietHoursEnd != null ? `${settings.quietHoursStart}:00 to ${settings.quietHoursEnd}:00` : "Not set" });
        rows.push({ label: "Notification retry limit", value: settings.notificationRetryLimit });
        rows.push({ label: "Default notification language", value: settings.defaultNotificationLanguage });
      }
      return { rows, problems };
    }
    case "approvals": {
      const [total, enabled, platform] = await Promise.all([
        safe(() => prisma.approvalPolicy.count()),
        safe(() => prisma.approvalPolicy.count({ where: { enabled: true } })),
        safe(() => prisma.approvalPolicy.findMany({ where: { actionType: { startsWith: "PLATFORM_" } }, select: { actionType: true, enabled: true, requiredLevel: true } })),
      ]);
      rows.push({ label: "Approval policies (enabled / total)", value: `${enabled} / ${total}` });
      for (const p of platform ?? []) rows.push({ label: p.actionType, value: `${p.enabled ? "Approval required" : "Approval off"} (${p.requiredLevel})` });
      if (platform && platform.length === 0) problems.push("The platform approval policies have not been created yet. They are created when the approval policies are first opened or seeded.");
      return { rows, problems };
    }
    case "payments": {
      if (!settings) return null;
      rows.push({ label: "Rollout stage", value: settings.paymentRolloutStage });
      rows.push({ label: "Active provider", value: settings.activePaymentProvider });
      rows.push({ label: "Payments / checkout / subscriptions", value: `${onOff(settings.paymentsEnabled)} / ${onOff(settings.checkoutEnabled)} / ${onOff(settings.subscriptionsEnabled)}` });
      rows.push({ label: "Refunds / manual payment", value: `${onOff(settings.refundsEnabled)} / ${onOff(settings.manualPaymentEnabled)}` });
      return { rows, problems };
    }
    case "ai": {
      const ai = await safe(() => prisma.aiConfig.findUnique({ where: { id: 1 } }));
      if (!ai) return null;
      rows.push({ label: "Rollout phase", value: ai.phase });
      rows.push({ label: "Provider", value: ai.provider });
      rows.push({ label: "External provider allowed", value: ai.externalProviderAllowed });
      rows.push({ label: "Kill switch", value: ai.killSwitchActive ? "Engaged" : "Released" });
      rows.push({ label: "Daily / monthly request caps", value: `${ai.dailyRequestCap} / ${ai.monthlyRequestCap}` });
      return { rows, problems };
    }
    case "privacy":
    case "legal": {
      const [active, total] = await Promise.all([safe(() => prisma.retentionPolicy.count({ where: { isActive: true } })), safe(() => prisma.retentionPolicy.count())]);
      rows.push({ label: "Retention policies (active / total)", value: `${active} / ${total}` });
      if (active === 0) rows.push({ label: "Note", value: "With no active retention policy nothing is deleted automatically (absent policy = keep)." });
      return { rows, problems };
    }
    case "membership": {
      const [active, total] = await Promise.all([safe(() => prisma.package.count({ where: { active: true } })), safe(() => prisma.package.count())]);
      rows.push({ label: "Packages (active / total)", value: `${active} / ${total}` });
      if (settings) rows.push({ label: "Renewals / coupons / referrals / promotions / credits", value: [settings.renewalsEnabled, settings.couponsEnabled, settings.referralsEnabled, settings.promotionsEnabled, settings.creditsEnabled].map(onOff).join(" / ") });
      rows.push({ label: "Subscriptions switch", value: flag("subscriptions.enabled") });
      return { rows, problems };
    }
    case "marketing": {
      const conns = await safe(() => prisma.marketingProviderConnection.findMany({ select: { providerKey: true, status: true } }));
      rows.push({ label: "Marketing switch / lead capture / site visitor counting", value: `${flag("marketing.enabled")} / ${flag("marketing.lead_capture.enabled")} / ${flag("marketing.site_events.enabled")}` });
      rows.push({ label: "Provider connections", value: conns ? (conns.length ? conns.map((c) => `${c.providerKey}: ${c.status}`).join(", ") : "None") : null });
      return { rows, problems };
    }
    case "analytics": {
      rows.push({ label: "Analytics switch / reports / alerts", value: `${flag("analytics.enabled")} / ${flag("analytics.reports.enabled")} / ${flag("analytics.alerts.enabled")}` });
      return { rows, problems };
    }
    case "security":
    case "authentication": {
      const control = await safe(() => getSystemControl());
      if (settings) {
        rows.push({ label: "Failed sign-ins before lock-out / lock-out minutes", value: `${settings.loginMaxAttempts} / ${settings.loginLockoutMinutes}` });
        rows.push({ label: "Minimum password length", value: settings.passwordMinLength });
        rows.push({ label: "Roles that must use two-factor", value: Array.isArray(settings.twoFactorRequiredRoles) && settings.twoFactorRequiredRoles.length ? (settings.twoFactorRequiredRoles as string[]).join(", ") : "None set" });
      }
      if (control) rows.push({ label: "Administrator session length (hours)", value: control.adminSessionMaxHours });
      rows.push({ label: "Security Operations / detection", value: `${flag("soc.enabled")} / ${flag("soc.detection.enabled")}` });
      return { rows, problems };
    }
    case "risk": {
      rows.push({ label: "Risk rules", value: await safe(() => prisma.riskRule.count()) });
      return { rows, problems };
    }
    case "workflows":
    case "tasks": {
      const [templates, slas, open] = await Promise.all([safe(() => prisma.taskTemplate.count()), safe(() => prisma.taskSlaConfig.count()), safe(() => prisma.adminTask.count({ where: { status: { in: ["NEW", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"] } } }))]);
      rows.push({ label: "Task templates", value: templates });
      rows.push({ label: "SLA configurations", value: slas });
      rows.push({ label: "Open tasks", value: open });
      return { rows, problems };
    }
    case "documents": {
      const types = await safe(() => prisma.documentTypeConfig.count());
      rows.push({ label: "Document types configured", value: types });
      if (settings) rows.push({ label: "Accepted verification document types", value: settings.acceptedDocumentTypes ?? "Default" });
      rows.push({ label: "Uploads switch", value: flag("uploads.enabled") });
      rows.push({ label: "Private files", value: "Never public: served only through signed, permission-checked routes." });
      return { rows, problems };
    }
    case "support": {
      const open = await safe(() => prisma.supportMessage.count({ where: { resolved: false } }));
      rows.push({ label: "Unresolved support messages", value: open });
      rows.push({ label: "Support form switch", value: flag("support.enabled") });
      return { rows, problems };
    }
    case "proposals": {
      rows.push({ label: "Proposals switch", value: flag("proposals.enabled") });
      if (settings) rows.push({ label: "Pending-proposal reminder (days)", value: settings.pendingProposalReminderDays });
      const control = await safe(() => getSystemControl());
      if (control) rows.push({ label: "Contact-sharing emergency switch", value: control.emergencyContactSharingDisabled ? "Engaged (no new shares)" : "Released" });
      return { rows, problems };
    }
    case "family": {
      rows.push({ label: "Family members", value: await safe(() => prisma.familyMember.count()) });
      return { rows, problems };
    }
    case "crm": {
      rows.push({ label: "CRM assignment rules", value: await safe(() => prisma.assignmentRuleConfig.count()) });
      return { rows, problems };
    }
    case "backup": {
      const [last, restore] = await Promise.all([safe(() => prisma.backupRun.findFirst({ where: { type: "DATABASE" }, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true } })), safe(() => prisma.restoreTest.findFirst({ orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true } }))]);
      rows.push({ label: "Latest database backup", value: last ? `${last.status} at ${last.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "None yet" });
      rows.push({ label: "Latest restore test", value: restore ? `${restore.status} at ${restore.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : "None yet" });
      return { rows, problems };
    }
    default:
      return null;
  }
}
