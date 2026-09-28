import { prisma } from "@/lib/prisma";
import { getEffectiveRule } from "@/lib/risk/config";
import { createRiskSignal, suppressedRelatedProfiles } from "@/lib/risk/signal-service";
import { assessProfile } from "@/lib/risk/assessment-service";
import { openRiskCase } from "@/lib/risk/case-service";
import { evaluateProfileDuplicates } from "@/lib/risk/duplicate-cluster-service";
import { deviceSignalsAllowed } from "@/lib/security/signal-policy";
import { writeAudit } from "@/lib/audit";
import type { SecurityEvent, SecurityEventType } from "@prisma/client";

// RiskRuleEngine. Every method here can do exactly two things: create
// signals, and request an assessment (which may open a human-review case).
// There is deliberately no code path in this file that restricts, suspends,
// rejects or closes anything — see case-service.ts for the only such paths,
// all of which require a human actor.

const HOUR = 3_600_000;
const MINUTE = 60_000;

export interface RuleEvaluationResult {
  signalsCreated: number;
  profileId?: string;
}

const NONE: RuleEvaluationResult = { signalsCreated: 0 };

function num(config: Record<string, number | boolean>, key: string): number {
  return Number(config[key]);
}

async function countEvents(where: Record<string, unknown>): Promise<number> {
  return prisma.securityEvent.count({ where });
}

async function signalFor(profileId: string, args: Parameters<typeof createRiskSignal>[0]): Promise<RuleEvaluationResult> {
  const result = await createRiskSignal(args);
  return { signalsCreated: result.created ? 1 : 0, profileId };
}

// ---- account security: failed logins, OTP abuse ----
async function evaluateAccountSecurity(profileId: string): Promise<RuleEvaluationResult> {
  let created = 0;
  const [login, otp] = await Promise.all([getEffectiveRule("login_abuse"), getEffectiveRule("otp_abuse")]);

  const failedLogins = await countEvents({ profileId, eventType: "LOGIN_FAILED", createdAt: { gte: new Date(Date.now() - num(login.config, "windowMinutes") * MINUTE) } });
  if (failedLogins >= num(login.config, "threshold")) {
    created += (await signalFor(profileId, { profileId, flagType: "LOGIN_ABUSE_SIGNAL", ruleKey: "login_abuse", ruleVersion: login.version, description: `${failedLogins} failed sign-in attempts against this account within ${num(login.config, "windowMinutes")} minutes.`, source: "security-event-bus" })).signalsCreated;
  }

  // A single mistyped code never reaches this threshold (default 10).
  const otpEvents = await countEvents({ profileId, eventType: { in: ["OTP_REQUESTED", "OTP_FAILED"] as SecurityEventType[] }, createdAt: { gte: new Date(Date.now() - num(otp.config, "windowMinutes") * MINUTE) } });
  if (otpEvents >= num(otp.config, "threshold")) {
    created += (await signalFor(profileId, { profileId, flagType: "OTP_ABUSE_SIGNAL", ruleKey: "otp_abuse", ruleVersion: otp.version, description: `${otpEvents} one-time-code requests or failures within ${num(otp.config, "windowMinutes")} minutes.`, source: "security-event-bus" })).signalsCreated;
  }
  return { signalsCreated: created, profileId };
}

// ---- contact-workflow bypass ----
async function evaluateContactActivity(profileId: string): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("contact_bypass");
  const count = await countEvents({ profileId, eventType: "CONTACT_BYPASS_ATTEMPT", createdAt: { gte: new Date(Date.now() - num(rule.config, "windowHours") * HOUR) } });
  if (count < num(rule.config, "threshold")) return { signalsCreated: 0, profileId };
  return signalFor(profileId, { profileId, flagType: "CONTACT_BYPASS_ATTEMPT", ruleKey: "contact_bypass", ruleVersion: rule.version, description: `${count} attempts to reach contact details before permission was granted within ${num(rule.config, "windowHours")} hours.`, source: "security-event-bus" });
}

// ---- family access ----
async function evaluateFamilyActivity(profileId: string): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("family_access_abuse");
  const count = await countEvents({ profileId, eventType: { in: ["FAMILY_INVITE_CREATED", "FAMILY_ACCESS_REQUESTED"] as SecurityEventType[] }, createdAt: { gte: new Date(Date.now() - num(rule.config, "windowHours") * HOUR) } });
  if (count < num(rule.config, "threshold")) return { signalsCreated: 0, profileId };
  return signalFor(profileId, { profileId, flagType: "FAMILY_ACCESS_ABUSE_SIGNAL", ruleKey: "family_access_abuse", ruleVersion: rule.version, description: `${count} family invitation/access requests within ${num(rule.config, "windowHours")} hours.`, source: "security-event-bus" });
}

// ---- repeated identity-adjacent changes ----
async function evaluateProfileChurn(profileId: string): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("profile_churn");
  const count = await countEvents({ profileId, eventType: { in: ["PROFILE_UPDATED", "CONTACT_UPDATED"] as SecurityEventType[] }, createdAt: { gte: new Date(Date.now() - num(rule.config, "windowHours") * HOUR) } });
  if (count < num(rule.config, "threshold")) return { signalsCreated: 0, profileId };
  return signalFor(profileId, { profileId, flagType: "PROFILE_CHURN_SIGNAL", ruleKey: "profile_churn", ruleVersion: rule.version, description: `${count} profile or contact changes within ${num(rule.config, "windowHours")} hours.`, source: "security-event-bus" });
}

// ---- verification: only genuine rejections/mismatches; provider trouble is NOT a signal ----
async function evaluateVerification(profileId: string): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("verification_failures");
  const count = await countEvents({ profileId, eventType: "VERIFICATION_FAILED", outcome: { in: ["REJECTED", "MISMATCH"] }, createdAt: { gte: new Date(Date.now() - num(rule.config, "windowHours") * HOUR) } });
  if (count < num(rule.config, "threshold")) return { signalsCreated: 0, profileId };
  return signalFor(profileId, { profileId, flagType: "IDENTITY_VERIFICATION_REVIEW", ruleKey: "verification_failures", ruleVersion: rule.version, description: `${count} identity-verification attempts were not accepted within ${num(rule.config, "windowHours")} hours; manual review of the verification is suggested.`, source: "security-event-bus" });
}

// ---- payments (risk-only: payment status never touches matching) ----
async function evaluatePayments(profileId: string): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("payment_anomaly");
  const count = await countEvents({ profileId, eventType: "PAYMENT_FAILED", createdAt: { gte: new Date(Date.now() - num(rule.config, "windowHours") * HOUR) } });
  if (count < num(rule.config, "threshold")) return { signalsCreated: 0, profileId };
  return signalFor(profileId, { profileId, flagType: "REPEATED_PAYMENT_FAILURE", ruleKey: "payment_anomaly", ruleVersion: rule.version, description: `${count} failed payment attempts within ${num(rule.config, "windowHours")} hours.`, source: "security-event-bus" });
}

// ---- device / network (OFF by default; jurisdiction-gated; hashed only; context, never sole basis) ----
async function evaluateSharedIdentifiers(profileId: string, kind: "device" | "network"): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule(kind === "device" ? "shared_device" : "unusual_network");
  if (rule.config.enabled !== true) return { signalsCreated: 0, profileId };
  if (!(await deviceSignalsAllowed(profileId))) return { signalsCreated: 0, profileId };

  const since = new Date(Date.now() - num(rule.config, "windowDays") * 24 * HOUR);
  const field = kind === "device" ? "userAgentHash" : "ipHash";
  const mine = await prisma.securityEvent.findMany({ where: { profileId, createdAt: { gte: since }, [field]: { not: null } }, distinct: [field], select: { userAgentHash: true, ipHash: true }, take: 5 });

  let maxOthers = 0;
  for (const row of mine) {
    const hash = kind === "device" ? row.userAgentHash : row.ipHash;
    if (!hash) continue;
    const others = await prisma.securityEvent.findMany({ where: { [field]: hash, profileId: { not: profileId }, createdAt: { gte: since } }, distinct: ["profileId"], select: { profileId: true }, take: 50 });
    const ids = others.map((o) => o.profileId).filter((x): x is string => !!x);
    const explained = await suppressedRelatedProfiles(profileId, ids); // family / cleared pairs never count
    maxOthers = Math.max(maxOthers, ids.filter((i) => !explained.has(i)).length);
  }
  if (maxOthers + 1 < num(rule.config, "minProfiles")) return { signalsCreated: 0, profileId };
  return signalFor(profileId, {
    profileId,
    flagType: kind === "device" ? "SHARED_DEVICE_SIGNAL" : "UNUSUAL_NETWORK_ACTIVITY",
    ruleKey: kind === "device" ? "shared_device" : "unusual_network",
    ruleVersion: rule.version,
    description: `This account shares a ${kind} identifier with ${maxOthers} other account(s). Shared ${kind === "device" ? "devices" : "networks"} are common (families, offices); this is context only.`,
    source: "security-event-bus",
  });
}

// ---- privileged access: volume only, admin-subject cases, never an accusation ----
async function evaluateAdminActivity(adminId: string): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("privileged_access_volume");
  const since = new Date(Date.now() - num(rule.config, "windowHours") * HOUR);
  const targets = await prisma.securityEvent.findMany({ where: { adminId, eventType: "ADMIN_SENSITIVE_ACCESS", createdAt: { gte: since } }, distinct: ["profileId"], select: { profileId: true }, take: 500 });
  const distinct = targets.length;
  if (distinct < num(rule.config, "distinctTargets")) return NONE;

  const result = await openRiskCase({
    subjectAdminId: adminId,
    category: "ADMIN_ACCESS",
    title: "Unusual privileged-access volume",
    riskLevel: "MEDIUM",
    openedBy: "rule-engine:privileged_access_volume",
  });
  if (result.created) {
    await writeAudit({ action: "RISK_ADMIN_ACCESS_ANOMALY", meta: { riskCaseId: result.riskCase.id, distinctTargets: distinct, windowHours: num(rule.config, "windowHours"), ruleVersion: rule.version } });
  }
  return { signalsCreated: result.created ? 1 : 0 };
}

// ---- permission denials / auth failures ----
async function evaluatePermissionDenials(event: SecurityEvent): Promise<RuleEvaluationResult> {
  const rule = await getEffectiveRule("permission_denied_burst");
  const since = new Date(Date.now() - num(rule.config, "windowMinutes") * MINUTE);
  const types = ["PERMISSION_DENIED", "API_AUTH_FAILURE"] as SecurityEventType[];

  if (event.adminId) {
    const count = await countEvents({ adminId: event.adminId, eventType: { in: types }, createdAt: { gte: since } });
    if (count < num(rule.config, "threshold")) return NONE;
    const result = await openRiskCase({ subjectAdminId: event.adminId, category: "ADMIN_ACCESS", title: "Repeated permission denials", riskLevel: "MEDIUM", openedBy: "rule-engine:permission_denied_burst" });
    return { signalsCreated: result.created ? 1 : 0 };
  }
  if (event.profileId) {
    const count = await countEvents({ profileId: event.profileId, eventType: { in: types }, createdAt: { gte: since } });
    if (count < num(rule.config, "threshold")) return { signalsCreated: 0, profileId: event.profileId };
    return signalFor(event.profileId, { profileId: event.profileId, flagType: "UNAUTHORIZED_ACCESS_ATTEMPT", ruleKey: "permission_denied_burst", ruleVersion: rule.version, description: `${count} denied access attempts within ${num(rule.config, "windowMinutes")} minutes.`, source: "security-event-bus" });
  }
  return NONE;
}

// Real-time dispatcher used by the SecurityEventBus. Bounded: a handful of
// indexed window counts. Failures are swallowed by the bus (fail-open).
async function evaluateSecurityEvent(event: SecurityEvent): Promise<RuleEvaluationResult> {
  let result: RuleEvaluationResult = NONE;
  switch (event.eventType) {
    case "LOGIN_FAILED":
    case "OTP_REQUESTED":
    case "OTP_FAILED":
      if (event.profileId) result = await evaluateAccountSecurity(event.profileId);
      break;
    case "CONTACT_BYPASS_ATTEMPT":
      if (event.profileId) result = await evaluateContactActivity(event.profileId);
      break;
    case "PERMISSION_DENIED":
    case "API_AUTH_FAILURE":
      result = await evaluatePermissionDenials(event);
      break;
    case "ADMIN_SENSITIVE_ACCESS":
      if (event.adminId) result = await evaluateAdminActivity(event.adminId);
      break;
    case "FAMILY_INVITE_CREATED":
    case "FAMILY_ACCESS_REQUESTED":
      if (event.profileId) result = await evaluateFamilyActivity(event.profileId);
      break;
    case "PROFILE_UPDATED":
    case "CONTACT_UPDATED":
      if (event.profileId) result = await evaluateProfileChurn(event.profileId);
      break;
    case "PAYMENT_FAILED":
      if (event.profileId) result = await evaluatePayments(event.profileId);
      break;
    case "VERIFICATION_FAILED":
      if (event.profileId) result = await evaluateVerification(event.profileId);
      break;
    default:
      break;
  }
  if (result.signalsCreated > 0 && result.profileId) await assessProfile(result.profileId);
  return result;
}

// Full evaluation of one profile (used by the admin "evaluate" endpoint and the
// daily batch). Server-side only: it reads persisted state, never client input.
async function evaluateProfile(profileId: string): Promise<{ signalsCreated: number }> {
  const results = await Promise.all([
    evaluateAccountSecurity(profileId),
    evaluateContactActivity(profileId),
    evaluateFamilyActivity(profileId),
    evaluateProfileChurn(profileId),
    evaluateVerification(profileId),
    evaluatePayments(profileId),
    evaluateSharedIdentifiers(profileId, "device"),
    evaluateSharedIdentifiers(profileId, "network"),
    evaluateProfileDuplicates(profileId),
  ]);
  const signalsCreated = results.reduce((n, r) => n + r.signalsCreated, 0);
  return { signalsCreated };
}

export const RiskRuleEngine = {
  evaluateSecurityEvent,
  evaluateProfile,
  evaluateAccountSecurity,
  evaluateContactActivity,
  evaluateFamilyActivity,
  evaluateProfileChurn,
  evaluateVerification,
  evaluatePayments,
  evaluateDeviceSignals: (profileId: string) => evaluateSharedIdentifiers(profileId, "device"),
  evaluateNetworkSignals: (profileId: string) => evaluateSharedIdentifiers(profileId, "network"),
  evaluateAdminActivity,
  evaluateDuplicateSignals: evaluateProfileDuplicates,
  calculateRiskAssessment: assessProfile,
};
