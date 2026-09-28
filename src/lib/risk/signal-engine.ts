// STEP 23 — Risk Signal Engine (STEP 24: thresholds are now versioned RiskRule config with the
// previous hard-coded values as defaults; signals are created through RiskSignalService; a scan
// that raises anything requests an assessment).
// SecurityFlag already IS the risk-signal store (see the STEP 23 plan's decision 1) — this is a
// service layer over that existing table, not a parallel model. Detector functions are pure
// (take pre-computed counts, return a boolean) so they're unit-testable without touching Prisma;
// the orchestrator does the actual counting.

import { prisma } from "@/lib/prisma";
import { getEffectiveRule } from "@/lib/risk/config";
import { createRiskSignal, suppressedRelatedProfiles } from "@/lib/risk/signal-service";
import { assessProfile } from "@/lib/risk/assessment-service";
import type { SecurityFlagType, SecurityFlagSeverity } from "@prisma/client";

// ---------- Pure detectors ----------

export function detectRapidRegistration(recentRegistrationsSharingSignal: number, thresholdPerWindow = 3): boolean {
  return recentRegistrationsSharingSignal >= thresholdPerWindow;
}

export function detectContactReuse(distinctProfilesSharingContact: number, threshold = 2): boolean {
  return distinctProfilesSharingContact >= threshold;
}

export function detectExcessiveProposalActivity(proposalCountInWindow: number, thresholdPerDay = 20): boolean {
  return proposalCountInWindow >= thresholdPerDay;
}

export function detectAbnormalContactRequestActivity(contactRequestCountInWindow: number, thresholdPerDay = 10): boolean {
  return contactRequestCountInWindow >= thresholdPerDay;
}

export function detectPaymentAnomaly(failedPaymentCountInWindow: number, thresholdPerDay = 5): boolean {
  return failedPaymentCountInWindow >= thresholdPerDay;
}

// ---------- Orchestrator ----------

const HOUR_MS = 60 * 60 * 1000;

interface SignalDefinition {
  flagType: SecurityFlagType;
  severity: SecurityFlagSeverity;
  ruleKey: string;
  ruleVersion: number;
  triggered: boolean;
  description: string;
}

export interface RiskSignalScanResult {
  profilesScanned: number;
  signalsCreated: number;
}

// Single-profile scan over the batch-evaluated signal families (contact reuse, rapid
// registration, proposal/contact-request volume, payment failures). Deliberately conservative
// counting rather than a scoring model: an explainable trigger an admin can verify against raw
// data. Sharing that a human has already explained (authorized family account, family relation,
// "not a duplicate") is excluded, so a spouse sharing a phone is not flagged.
export async function runRiskSignalScan(profileId: string): Promise<RiskSignalScanResult> {
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile || !profile.contact) return { profilesScanned: 0, signalsCreated: 0 };

  const [rapid, reuse, proposals, contactRequests, payments] = await Promise.all([
    getEffectiveRule("rapid_registration"),
    getEffectiveRule("contact_reuse"),
    getEffectiveRule("excessive_proposals"),
    getEffectiveRule("abnormal_contact_requests"),
    getEffectiveRule("payment_anomaly"),
  ]);
  const hoursAgo = (config: Record<string, number | boolean>, key: string) => new Date(Date.now() - Number(config[key]) * HOUR_MS);

  const sharedContactWhere = {
    OR: [{ mobileNumber: profile.contact.mobileNumber }, { email: { equals: profile.contact.email, mode: "insensitive" as const } }],
    profileId: { not: profileId },
  };
  const sharing = await prisma.contactInfo.findMany({ where: sharedContactWhere, select: { profileId: true, profile: { select: { createdAt: true } } } });
  const explained = await suppressedRelatedProfiles(profileId, sharing.map((s) => s.profileId));
  const effective = sharing.filter((s) => !explained.has(s.profileId));
  const sharedContactCount = effective.length;
  const rapidSince = Date.now() - Number(rapid.config.windowMinutes) * 60_000;
  const recentSharedContactCount = effective.filter((s) => s.profile.createdAt.getTime() >= rapidSince).length;

  const [proposalCount, contactRequestCount, failedPaymentCount] = await Promise.all([
    prisma.proposal.count({ where: { OR: [{ profileAId: profileId }, { profileBId: profileId }], createdAt: { gte: hoursAgo(proposals.config, "windowHours") } } }),
    prisma.contactPermission.count({ where: { profileId, requestedAt: { gte: hoursAgo(contactRequests.config, "windowHours") } } }),
    prisma.payment.count({ where: { profileId, status: "FAILED", createdAt: { gte: hoursAgo(payments.config, "windowHours") } } }),
  ]);

  const definitions: SignalDefinition[] = [
    {
      flagType: "RAPID_REGISTRATION_SIGNAL",
      severity: "MEDIUM",
      ruleKey: "rapid_registration",
      ruleVersion: rapid.version,
      triggered: detectRapidRegistration(recentSharedContactCount + 1, Number(rapid.config.threshold)),
      description: `${recentSharedContactCount} other profile(s) sharing this profile's mobile number or email were registered within the last ${Number(rapid.config.windowMinutes)} minutes.`,
    },
    {
      flagType: "CONTACT_REUSE_SIGNAL",
      severity: "MEDIUM",
      ruleKey: "contact_reuse",
      ruleVersion: reuse.version,
      triggered: detectContactReuse(sharedContactCount + 1, Number(reuse.config.threshold)),
      description: `This profile's mobile number or email is shared with ${sharedContactCount} other profile(s).`,
    },
    {
      flagType: "EXCESSIVE_PROPOSAL_ACTIVITY",
      severity: "LOW",
      ruleKey: "excessive_proposals",
      ruleVersion: proposals.version,
      triggered: detectExcessiveProposalActivity(proposalCount, Number(proposals.config.threshold)),
      description: `${proposalCount} proposal(s) involving this profile in the last ${Number(proposals.config.windowHours)} hours.`,
    },
    {
      flagType: "ABNORMAL_CONTACT_REQUEST_ACTIVITY",
      severity: "MEDIUM",
      ruleKey: "abnormal_contact_requests",
      ruleVersion: contactRequests.version,
      triggered: detectAbnormalContactRequestActivity(contactRequestCount, Number(contactRequests.config.threshold)),
      description: `${contactRequestCount} contact-sharing request(s) from this profile in the last ${Number(contactRequests.config.windowHours)} hours.`,
    },
    {
      flagType: "PAYMENT_ANOMALY_SIGNAL",
      severity: "MEDIUM",
      ruleKey: "payment_anomaly",
      ruleVersion: payments.version,
      triggered: detectPaymentAnomaly(failedPaymentCount, Number(payments.config.threshold)),
      description: `${failedPaymentCount} failed payment attempt(s) from this profile in the last ${Number(payments.config.windowHours)} hours.`,
    },
  ];

  let signalsCreated = 0;
  for (const def of definitions) {
    if (!def.triggered) continue;
    const result = await createRiskSignal({ profileId, flagType: def.flagType, severity: def.severity, ruleKey: def.ruleKey, ruleVersion: def.ruleVersion, description: def.description });
    if (result.created) signalsCreated++;
  }
  if (signalsCreated > 0) await assessProfile(profileId);

  return { profilesScanned: 1, signalsCreated };
}
