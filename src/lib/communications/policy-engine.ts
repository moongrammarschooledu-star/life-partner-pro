import { prisma } from "@/lib/prisma";
import type { CommunicationMessageType, CommunicationPurpose, CommunicationSuppression, Locale, NotificationChannel, NotificationType } from "@prisma/client";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { evaluateRequirement } from "@/lib/compliance/rule-engine";
import { getFamilyMembership, hasFamilyPermission } from "@/lib/family/access-control";
import { classify, shouldAttemptExternalChannel, type PreferenceCategory } from "@/lib/notifications/classification";
import { ALLOWED_PURPOSES, CLASS_MESSAGE_TYPES, SENSITIVE_PURPOSES, messageClassOf, type MessageClass } from "@/lib/communications/classify";
import { getPolicy, type FrequencyLimit, type QuietHoursConfig } from "@/lib/communications/policy-config";
import { resolveProviderChain, type ResolvedProvider } from "@/lib/communications/providers/registry";
import { hashDestination } from "@/lib/communications/suppression-hash";

// CommunicationPolicyEngine (spec §48/§71). EVERY outbound message passes through canSend() first, and the rule is simple:
// if ANY mandatory check fails the message is NOT sent - it is recorded as blocked with a reason code (and, where a human should
// look at it, a review task is raised by the caller). Nothing here sends anything.
//
// Order: recipient -> purpose -> restriction -> channel enabled -> consent/preferences -> suppression -> jurisdiction ->
//        frequency -> quiet hours (defers, never blocks) -> provider eligibility (incl. the environment guard).

export interface CommunicationIntent {
  recipient:
    | { type: "PROFILE"; profileId: string }
    | { type: "FAMILY_MEMBER"; familyMemberId: string; requiredPermission?: string }
    | { type: "ADMIN"; adminId: string };
  channel: NotificationChannel;
  messageType: CommunicationMessageType;
  purpose: CommunicationPurpose;
  eventKey?: NotificationType; // set for system notifications so the existing preference / essential rules apply unchanged
  automated: boolean; // false = a person initiated this send
  initiatedBy?: { adminId: string; permissions: readonly string[] };
  proposalId?: string | null;
  now?: Date;
  ignoreQuietHours?: boolean;
}

export type BlockedCode =
  | "BLOCKED_RECIPIENT_NOT_FOUND"
  | "BLOCKED_ACCOUNT_STATE"
  | "BLOCKED_NO_DESTINATION"
  | "BLOCKED_CONTACT_NOT_VERIFIED"
  | "BLOCKED_PURPOSE_MISMATCH"
  | "BLOCKED_SENSITIVE_PERMISSION"
  | "BLOCKED_RESTRICTION"
  | "BLOCKED_CHANNEL_DISABLED"
  | "BLOCKED_CONSENT"
  | "BLOCKED_NO_MARKETING_CONSENT"
  | "BLOCKED_MARKETING_DISABLED"
  | "BLOCKED_SUPPRESSED"
  | "BLOCKED_JURISDICTION_RULE"
  | "BLOCKED_JURISDICTION_REVIEW"
  | "BLOCKED_FREQUENCY"
  | "BLOCKED_NO_PROVIDER"
  | "BLOCKED_INVALID_DESTINATION"
  | "BLOCKED_FAMILY_ACCESS"
  | "BLOCKED_CHANNEL_NOT_ALLOWED_FOR_RECIPIENT";

export interface PolicyDecision {
  allowed: boolean;
  reviewRequired: boolean;
  blockedCode?: BlockedCode;
  reasons: string[];
  deferUntil?: Date;
  destination?: string; // resolved server-side from the recipient's own record
  destinationHash?: string;
  language: Locale;
  country: string | null;
  jurisdictionUnresolved: boolean;
  messageClass: MessageClass;
  chain: ResolvedProvider[];
}

interface Verdict {
  ok: boolean;
  code?: BlockedCode;
  reason?: string;
  review?: boolean;
}
const OK: Verdict = { ok: true };
const block = (code: BlockedCode, reason: string, review = false): Verdict => ({ ok: false, code, reason, review });

// ---------------------------------------------------------------- pure helpers (unit-tested)

export function withinQuietHours(now: Date, cfg: Pick<QuietHoursConfig, "start" | "end" | "timezone">): { quiet: boolean; endsAt: Date | null } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: cfg.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const local = hh * 60 + mm;
  const [sh, sm] = cfg.start.split(":").map(Number);
  const [eh, em] = cfg.end.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return { quiet: false, endsAt: null };
  const quiet = start < end ? local >= start && local < end : local >= start || local < end; // window may cross midnight
  if (!quiet) return { quiet: false, endsAt: null };
  const minutesUntilEnd = (end - local + 1440) % 1440 || 1440;
  return { quiet: true, endsAt: new Date(now.getTime() + minutesUntilEnd * 60_000) };
}

export function overFrequency(timestamps: readonly Date[], limit: FrequencyLimit, now: Date): { over: boolean; window?: "hour" | "day" | "week" } {
  const t = now.getTime();
  const count = (ms: number) => timestamps.filter((d) => t - d.getTime() < ms).length;
  if (count(3_600_000) >= limit.perHour) return { over: true, window: "hour" };
  if (count(86_400_000) >= limit.perDay) return { over: true, window: "day" };
  if (count(7 * 86_400_000) >= limit.perWeek) return { over: true, window: "week" };
  return { over: false };
}

// Which suppression scopes apply to a message class. Security / verification messages are only stopped by an ALL-scope suppression
// (e.g. a hard bounce), never by an unsubscribe from marketing.
export function suppressionApplies(scope: string, cls: MessageClass): boolean {
  if (scope === "ALL") return true;
  if (scope === "MARKETING") return cls === "marketing";
  if (scope === "TRANSACTIONAL") return cls === "transactional";
  return false;
}

const PREFERENCE_CATEGORY_FOR_PURPOSE: Partial<Record<CommunicationPurpose, Exclude<PreferenceCategory, null>>> = {
  PROPOSAL: "PROPOSAL",
  CONTACT_PERMISSION: "PROPOSAL",
  MATCH: "PROPOSAL",
  MEETING: "MEETING",
  FOLLOWUP: "FOLLOWUP",
  MARKETING: "MARKETING",
};

const CHANNEL_KEY: Record<NotificationChannel, "inApp" | "email" | "sms" | "whatsapp"> = { IN_APP: "inApp", EMAIL: "email", SMS: "sms", WHATSAPP: "whatsapp" };
const CATEGORY_KEY: Record<Exclude<PreferenceCategory, null>, string> = { PROPOSAL: "ProposalUpdates", MEETING: "MeetingUpdates", FOLLOWUP: "FollowUpReminders", MARKETING: "Marketing" };

// ---------------------------------------------------------------- individual checks (spec §48 method list)

interface RecipientRecord {
  id: string;
  status: string;
  accountStatus: string;
  softDeleted: boolean;
  country: string;
  preferredLanguage: Locale;
  contact: { mobileNumber: string; whatsappNumber: string | null; email: string } | null;
  verification: { phoneVerifiedAt: Date | null; emailVerifiedAt: Date | null } | null;
}

async function loadRecipient(profileId: string): Promise<RecipientRecord | null> {
  const p = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      status: true,
      accountStatus: true,
      softDeleted: true,
      country: true,
      preferredLanguage: true,
      contact: { select: { mobileNumber: true, whatsappNumber: true, email: true } },
      verification: { select: { phoneVerifiedAt: true, emailVerifiedAt: true } },
    },
  });
  return p as RecipientRecord | null;
}

const ALWAYS_ALLOWED_STATES: CommunicationMessageType[] = ["SECURITY", "PRIVACY", "PAYMENT", "SUPPORT", "VERIFICATION"];
const SECURITY_CRITICAL: CommunicationMessageType[] = ["SECURITY", "VERIFICATION", "PRIVACY", "PAYMENT"];

export function destinationFor(channel: NotificationChannel, contact: RecipientRecord["contact"]): string | null {
  if (!contact) return null;
  if (channel === "EMAIL") return contact.email || null;
  if (channel === "SMS") return contact.mobileNumber || null;
  if (channel === "WHATSAPP") return contact.whatsappNumber || null; // never falls back to the mobile number: WhatsApp needs the recipient's own WhatsApp number
  return null;
}

export async function checkRecipientEligibility(intent: CommunicationIntent, recipient: RecipientRecord | null): Promise<Verdict> {
  if (intent.recipient.type !== "PROFILE") return OK;
  if (!recipient || recipient.softDeleted) return block("BLOCKED_RECIPIENT_NOT_FOUND", "The recipient does not exist or was deleted.");
  const alwaysOk = ALWAYS_ALLOWED_STATES.includes(intent.messageType);
  if (!alwaysOk) {
    if (recipient.accountStatus !== "ACTIVE") return block("BLOCKED_ACCOUNT_STATE", `The account is ${recipient.accountStatus.toLowerCase()}.`);
    if (["SUSPENDED", "REJECTED", "ARCHIVED"].includes(recipient.status)) return block("BLOCKED_ACCOUNT_STATE", `The profile is ${recipient.status.toLowerCase()}.`);
  }
  if (intent.channel !== "IN_APP") {
    const destination = destinationFor(intent.channel, recipient.contact);
    if (!destination) return block("BLOCKED_NO_DESTINATION", "The recipient has no address for this channel.");
    const { config } = await getPolicy("JURISDICTION_DEFAULTS");
    const needsVerified = (config.requireVerifiedContactFor as readonly string[]).includes(intent.messageType);
    if (needsVerified) {
      const verified = intent.channel === "EMAIL" ? !!recipient.verification?.emailVerifiedAt : !!recipient.verification?.phoneVerifiedAt;
      if (!verified) return block("BLOCKED_CONTACT_NOT_VERIFIED", "The contact method is not verified.");
    }
  }
  return OK;
}

export function checkPurposeAllowed(intent: CommunicationIntent): Verdict {
  if (!ALLOWED_PURPOSES[intent.messageType].includes(intent.purpose)) return block("BLOCKED_PURPOSE_MISMATCH", `Purpose ${intent.purpose} is not allowed for ${intent.messageType} messages.`);
  return OK;
}

export function checkSensitiveAccess(intent: CommunicationIntent): Verdict {
  if (intent.automated || !SENSITIVE_PURPOSES.includes(intent.purpose)) return OK;
  const perms = intent.initiatedBy?.permissions ?? [];
  if (!perms.includes("communications:send_sensitive") && !perms.includes("sensitive:communication:send")) return block("BLOCKED_SENSITIVE_PERMISSION", "This purpose needs the sensitive-communication permission.");
  return OK;
}

export async function checkRestrictions(intent: CommunicationIntent): Promise<Verdict> {
  if (intent.recipient.type !== "PROFILE") return OK;
  // Risk restrictions limit communication a PERSON initiates, and marketing pushes. They never stop security, verification, privacy or
  // payment notices, and they never stop ordinary system notifications about the recipient's own account.
  if ((SECURITY_CRITICAL as readonly string[]).includes(intent.messageType)) return OK;
  if (intent.automated && intent.messageType !== "MARKETING") return OK;
  const id = intent.recipient.profileId;
  if ((await hasActiveRestriction(id, "COMMUNICATION_RESTRICTED")) || (await hasActiveRestriction(id, "FULL_ACCOUNT_RESTRICTED"))) return block("BLOCKED_RESTRICTION", "The profile is currently restricted from this kind of communication.");
  return OK;
}

export async function checkChannelEnabled(channel: NotificationChannel): Promise<Verdict> {
  if (channel === "IN_APP") return OK;
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const enabled = channel === "EMAIL" ? (settings?.emailNotificationsEnabled ?? true) : channel === "SMS" ? (settings?.smsNotificationsEnabled ?? false) : (settings?.whatsappNotificationsEnabled ?? false);
  return enabled ? OK : block("BLOCKED_CHANNEL_DISABLED", `The ${channel.toLowerCase()} channel is switched off.`);
}

export async function getCommunicationPreference(profileId: string, channel: NotificationChannel, category: Exclude<PreferenceCategory, null>): Promise<boolean | null> {
  const pref = await prisma.notificationPreference.findUnique({ where: { profileId } });
  if (!pref) return null;
  const value = (pref as unknown as Record<string, unknown>)[`${CHANNEL_KEY[channel]}${CATEGORY_KEY[category]}`];
  return typeof value === "boolean" ? value : null;
}

export async function checkConsent(intent: CommunicationIntent): Promise<Verdict> {
  if (intent.recipient.type !== "PROFILE") return OK;
  const profileId = intent.recipient.profileId;
  const [pref, consent] = await Promise.all([prisma.notificationPreference.findUnique({ where: { profileId } }), prisma.communicationConsent.findUnique({ where: { profileId_channel: { profileId, channel: intent.channel } } })]);
  const consentStatus = (consent?.status as "GRANTED" | "REVOKED" | undefined) ?? null;

  if (intent.messageType === "MARKETING") {
    if (!(await isFeatureEnabled("communications.marketing.enabled"))) return block("BLOCKED_MARKETING_DISABLED", "Marketing communication is switched off.");
    if (intent.channel === "IN_APP") return OK;
    const preference = pref ? ((pref as unknown as Record<string, unknown>)[`${CHANNEL_KEY[intent.channel]}Marketing`] as boolean | undefined) : undefined;
    // Marketing needs an EXPLICIT opt-in on both the preference and the channel consent - registering is never consent.
    if (preference !== true || consentStatus !== "GRANTED") return block("BLOCKED_NO_MARKETING_CONSENT", "The recipient has not opted in to marketing on this channel.");
    return OK;
  }

  if (intent.channel === "IN_APP") return OK;
  const category = intent.eventKey ? classify(intent.eventKey).preferenceCategory : (PREFERENCE_CATEGORY_FOR_PURPOSE[intent.purpose] ?? null);
  const essential = intent.eventKey ? classify(intent.eventKey).essential : ["SECURITY", "VERIFICATION", "PRIVACY", "PAYMENT"].includes(intent.messageType);
  const preferenceValue = category && pref ? (((pref as unknown as Record<string, unknown>)[`${CHANNEL_KEY[intent.channel]}${CATEGORY_KEY[category]}`] as boolean | undefined) ?? null) : null;

  // Re-use the platform's existing decision function so essential-vs-optional behaviour is byte-for-byte unchanged.
  const allowed = intent.eventKey
    ? shouldAttemptExternalChannel({ type: intent.eventKey, channelEnabledInSettings: true, preferenceValue, consentStatus })
    : essential || ((preferenceValue ?? true) && consentStatus !== "REVOKED");
  return allowed ? OK : block("BLOCKED_CONSENT", "The recipient's preference or consent does not allow this message.");
}

export async function checkSuppression(intent: CommunicationIntent, destination: string | undefined): Promise<Verdict> {
  const cls = messageClassOf(intent.messageType);
  const now = new Date();
  const or: Array<Record<string, unknown>> = [];
  if (intent.recipient.type === "PROFILE") or.push({ profileId: intent.recipient.profileId });
  if (intent.recipient.type === "FAMILY_MEMBER") or.push({ familyMemberId: intent.recipient.familyMemberId });
  if (destination) or.push({ destinationHash: hashDestination(destination) });
  if (or.length === 0) return OK;
  const rows: CommunicationSuppression[] = await prisma.communicationSuppression.findMany({
    where: { channel: intent.channel, status: "ACTIVE", OR: or as never },
    take: 20,
  });
  const active = rows.filter((r) => !r.expiresAt || r.expiresAt.getTime() > now.getTime());
  const hit = active.find((r) => suppressionApplies(r.scope, cls));
  return hit ? block("BLOCKED_SUPPRESSED", `Suppressed (${hit.reason.toLowerCase().replace(/_/g, " ")}).`) : OK;
}

export async function checkFrequencyLimit(intent: CommunicationIntent): Promise<Verdict> {
  if (intent.recipient.type !== "PROFILE" || intent.channel === "IN_APP") return OK;
  const cls = messageClassOf(intent.messageType);
  const { config } = await getPolicy("FREQUENCY");
  const now = intent.now ?? new Date();
  // Separate counters per class: a marketing limit can never consume the security budget.
  const rows = await prisma.communicationLog.findMany({
    where: {
      profileId: intent.recipient.profileId,
      channel: intent.channel,
      createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      blockedReason: null,
      OR: cls === "transactional" ? [{ messageType: { in: CLASS_MESSAGE_TYPES.transactional } }, { messageType: null }] : [{ messageType: { in: CLASS_MESSAGE_TYPES[cls] } }],
    },
    select: { createdAt: true },
    take: 500,
  });
  const result = overFrequency(rows.map((r) => r.createdAt), config[cls], now);
  return result.over ? block("BLOCKED_FREQUENCY", `The ${cls} message limit for this ${result.window} has been reached.`) : OK;
}

export async function resolveJurisdictionId(country: string | null | undefined): Promise<string | null> {
  if (!country) return null;
  const now = new Date();
  const j = await prisma.jurisdiction.findFirst({ where: { countryCode: country, status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, select: { id: true } });
  return j?.id ?? null;
}

// Jurisdiction gate (STEP 23). Rules are looked up for `channel:purpose`, then `channel:*`, then `*`. Absent an ACTIVE rule the law
// is NOT guessed: transactional/security traffic follows the configured default (ALLOW keeps existing flows such as OTP working and
// is recorded as jurisdictionUnresolved), marketing goes to REVIEW_REQUIRED and is blocked.
export async function checkJurisdiction(intent: CommunicationIntent, country: string | null): Promise<{ verdict: Verdict; unresolved: boolean }> {
  if (intent.channel === "IN_APP" || intent.recipient.type !== "PROFILE") return { verdict: OK, unresolved: false };
  const cls = messageClassOf(intent.messageType);
  const { config } = await getPolicy("JURISDICTION_DEFAULTS");
  const jurisdictionId = await resolveJurisdictionId(country);
  let value: { allowed?: boolean; reviewRequired?: boolean; reason?: string } | null = null;
  if (jurisdictionId) {
    for (const subject of [`${intent.channel}:${intent.purpose}`, `${intent.channel}:*`, "*"]) {
      const r = await evaluateRequirement<{ allowed?: boolean; reviewRequired?: boolean; reason?: string }>(jurisdictionId, "COMMUNICATION_POLICY", subject);
      if (r.resolved) {
        value = r.value;
        break;
      }
    }
  }
  if (value) {
    if (value.reviewRequired) return { verdict: block("BLOCKED_JURISDICTION_REVIEW", value.reason ?? "The jurisdiction rule requires a human review.", true), unresolved: false };
    if (value.allowed === false) return { verdict: block("BLOCKED_JURISDICTION_RULE", value.reason ?? "A jurisdiction rule does not allow this communication.", true), unresolved: false };
    return { verdict: OK, unresolved: false };
  }
  // No applicable rule.
  if (cls === "marketing") return { verdict: block("BLOCKED_JURISDICTION_REVIEW", "No active jurisdiction rule permits marketing here; review is required.", true), unresolved: true };
  const mode = config.unresolvedTransactional;
  if (mode === "BLOCK") return { verdict: block("BLOCKED_JURISDICTION_RULE", "Communication is blocked while the jurisdiction is unresolved."), unresolved: true };
  if (mode === "REVIEW") return { verdict: block("BLOCKED_JURISDICTION_REVIEW", "The jurisdiction is unresolved; review is required.", true), unresolved: true };
  return { verdict: OK, unresolved: true };
}

export async function checkProviderEligibility(params: { channel: NotificationChannel; destination: string; country?: string | null; language?: string | null }): Promise<{ verdict: Verdict; chain: ResolvedProvider[] }> {
  const { config } = await getPolicy("ENVIRONMENT");
  const chain = await resolveProviderChain({ channel: params.channel, destination: params.destination, country: params.country, language: params.language, testRecipientsConfigured: config.testRecipients });
  if (chain.length === 0) return { verdict: block("BLOCKED_NO_PROVIDER", "No provider is available for this channel."), chain };
  const valid = chain[0].adapter.validateRecipient(params.destination);
  if (!valid.valid) return { verdict: block("BLOCKED_INVALID_DESTINATION", `The destination is not valid (${valid.reason}).`), chain };
  return { verdict: OK, chain };
}

export async function checkFamilyRecipient(intent: CommunicationIntent): Promise<Verdict> {
  if (intent.recipient.type !== "FAMILY_MEMBER") return OK;
  if (intent.channel !== "IN_APP") return block("BLOCKED_CHANNEL_NOT_ALLOWED_FOR_RECIPIENT", "Family members are only contacted in-app.");
  const membership = await getFamilyMembership(intent.recipient.familyMemberId);
  if (!membership) return block("BLOCKED_FAMILY_ACCESS", "The family member has no active access.");
  // Family members never receive "everything": a permission is required whenever the message is tied to a record type.
  const required = intent.recipient.requiredPermission ?? (intent.proposalId ? "proposal.view" : undefined);
  if (required && !(await hasFamilyPermission(intent.recipient.familyMemberId, required))) return block("BLOCKED_FAMILY_ACCESS", "The family member has not been granted access to this kind of update.");
  return OK;
}

export function allowedChannelsFor(recipientType: CommunicationIntent["recipient"]["type"]): NotificationChannel[] {
  return recipientType === "PROFILE" ? ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] : ["IN_APP"];
}

// ---------------------------------------------------------------- the decision

export interface CanSendOptions {
  // Used when a message that is ALREADY queued is re-checked at send time: the queued row itself would otherwise count against
  // its own frequency limit.
  skipFrequency?: boolean;
}

export async function canSend(intent: CommunicationIntent, opts: CanSendOptions = {}): Promise<PolicyDecision> {
  const now = intent.now ?? new Date();
  const base: PolicyDecision = { allowed: false, reviewRequired: false, reasons: [], language: "EN", country: null, jurisdictionUnresolved: false, messageClass: messageClassOf(intent.messageType), chain: [] };
  const fail = (v: Verdict): PolicyDecision => ({ ...base, allowed: false, reviewRequired: !!v.review, blockedCode: v.code, reasons: [...base.reasons, v.reason ?? v.code ?? "Blocked"] });

  if (!allowedChannelsFor(intent.recipient.type).includes(intent.channel)) return fail(block("BLOCKED_CHANNEL_NOT_ALLOWED_FOR_RECIPIENT", "This channel is not available for this recipient type."));

  const purpose = checkPurposeAllowed(intent);
  if (!purpose.ok) return fail(purpose);
  const sensitive = checkSensitiveAccess(intent);
  if (!sensitive.ok) return fail(sensitive);

  if (intent.recipient.type === "ADMIN") {
    const admin = await prisma.adminUser.findUnique({ where: { id: intent.recipient.adminId }, select: { active: true } });
    return admin?.active ? { ...base, allowed: true } : fail(block("BLOCKED_RECIPIENT_NOT_FOUND", "The staff member is not active."));
  }
  if (intent.recipient.type === "FAMILY_MEMBER") {
    const fam = await checkFamilyRecipient(intent);
    if (!fam.ok) return fail(fam);
    const sup = await checkSuppression(intent, undefined);
    return sup.ok ? { ...base, allowed: true } : fail(sup);
  }

  const recipient = await loadRecipient(intent.recipient.profileId);
  const eligible = await checkRecipientEligibility(intent, recipient);
  if (!eligible.ok) return fail(eligible);
  const r = recipient as RecipientRecord;
  const destination = intent.channel === "IN_APP" ? undefined : (destinationFor(intent.channel, r.contact) ?? undefined);
  const withRecipient: PolicyDecision = { ...base, language: r.preferredLanguage, country: r.country, destination, destinationHash: destination ? hashDestination(destination) : undefined };
  const failR = (v: Verdict): PolicyDecision => ({ ...withRecipient, allowed: false, reviewRequired: !!v.review, blockedCode: v.code, reasons: [v.reason ?? v.code ?? "Blocked"] });

  for (const check of [await checkRestrictions(intent), await checkChannelEnabled(intent.channel), await checkConsent(intent), await checkSuppression(intent, destination)]) if (!check.ok) return failR(check);

  const juris = await checkJurisdiction(intent, r.country);
  if (!juris.verdict.ok) return { ...failR(juris.verdict), jurisdictionUnresolved: juris.unresolved };

  if (!opts.skipFrequency) {
    const freq = await checkFrequencyLimit(intent);
    if (!freq.ok) return failR(freq);
  }

  let chain: ResolvedProvider[] = [];
  if (intent.channel !== "IN_APP" && destination) {
    const provider = await checkProviderEligibility({ channel: intent.channel, destination, country: r.country, language: r.preferredLanguage });
    if (!provider.verdict.ok) return failR(provider.verdict);
    chain = provider.chain;
  }

  // Quiet hours defer (never drop) a message; security / verification (configurable) are exempt.
  let deferUntil: Date | undefined;
  if (!intent.ignoreQuietHours && intent.channel !== "IN_APP") {
    const { config } = await getPolicy("QUIET_HOURS");
    const exempt = (config.exceptionTypes as readonly string[]).includes(intent.messageType);
    if (config.enabled && !exempt && (config.channels as readonly string[]).includes(intent.channel)) {
      const q = withinQuietHours(now, config);
      if (q.quiet && q.endsAt) deferUntil = q.endsAt;
    }
  }

  return { ...withRecipient, allowed: true, reviewRequired: false, reasons: [], jurisdictionUnresolved: juris.unresolved, deferUntil, chain };
}

// Spec §48 - the named surface. Each entry delegates to the check above.
export const CommunicationPolicyEngine = {
  canSend,
  getAllowedChannels: allowedChannelsFor,
  getCommunicationPreference,
  getApplicableTemplate: async (params: { eventKey?: string; channel: NotificationChannel; language: Locale }) =>
    params.eventKey
      ? prisma.communicationTemplate.findFirst({ where: { eventKey: params.eventKey, channel: params.channel, language: params.language, status: "ACTIVE" }, orderBy: { currentVersion: "desc" } })
      : null,
  checkConsent,
  checkSuppression,
  checkFrequencyLimit,
  checkJurisdiction,
  checkRecipientEligibility: async (intent: CommunicationIntent) => checkRecipientEligibility(intent, intent.recipient.type === "PROFILE" ? await loadRecipient(intent.recipient.profileId) : null),
  checkProviderEligibility,
};
