// STEP 23 — Risk Signal Engine. SecurityFlag already IS the risk-signal
// store (see the STEP 23 plan's decision 1) — this is a service layer over
// that existing table, not a parallel model. Detector functions are pure
// (take pre-computed counts, return a boolean) so they're unit-testable
// without touching Prisma; the orchestrator does the actual counting and is
// admin-triggered, matching the existing duplicate-scan route's own explicit
// "never a background cron" precedent (this codebase has no queue/worker
// infrastructure).

import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifySecurityFlagRaised } from "@/lib/notifications/events";
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

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_1H_MS = 60 * 60 * 1000;

interface SignalDefinition {
  flagType: SecurityFlagType;
  severity: SecurityFlagSeverity;
  triggered: boolean;
  description: string;
}

// Creates (or leaves alone, if one is already open) exactly one SecurityFlag
// per signal type per profile — matching the existing duplicate-scan route's
// own "skip if an OPEN/INVESTIGATING flag already exists" dedup convention,
// so re-running the scan never piles up duplicate flags for the same
// ongoing condition.
async function raiseSignalIfNew(profileId: string, def: SignalDefinition): Promise<boolean> {
  if (!def.triggered) return false;

  const existing = await prisma.securityFlag.findFirst({
    where: { profileId, flagType: def.flagType, status: { in: ["OPEN", "INVESTIGATING"] } },
  });
  if (existing) return false;

  const flag = await prisma.securityFlag.create({
    data: { profileId, flagType: def.flagType, severity: def.severity, description: def.description },
  });

  await writeAudit({ action: "RISK_SIGNAL_DETECTED", targetProfileId: profileId, meta: { flagType: def.flagType, flagId: flag.id } });
  await notifySecurityFlagRaised(profileId, false, flag.id);
  await createFromEvent({
    eventName: "RISK_SIGNAL_DETECTED",
    dedupKey: `RISK_SIGNAL_REVIEW:${flag.id}`,
    resourceType: "PROFILE",
    resourceId: profileId,
    taskType: "RISK_SIGNAL_REVIEW",
    title: `Risk signal: ${def.flagType}`,
    description: def.description,
  });

  return true;
}

export interface RiskSignalScanResult {
  profilesScanned: number;
  signalsCreated: number;
}

// Admin-triggered, single-profile or platform-wide scan (never a cron) —
// evaluates the 5 new signal types over the last 24 hours. Deliberately
// conservative, simple counting queries rather than a scoring model: the
// point is an explainable trigger an admin can immediately understand and
// verify against the raw data, not a black-box heuristic.
export async function runRiskSignalScan(profileId: string): Promise<RiskSignalScanResult> {
  const since = new Date(Date.now() - WINDOW_24H_MS);
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile || !profile.contact) return { profilesScanned: 0, signalsCreated: 0 };

  const sharedContactWhere = { OR: [{ mobileNumber: profile.contact.mobileNumber }, { email: { equals: profile.contact.email, mode: "insensitive" as const } }], profileId: { not: profileId } };

  const [sharedContactCount, recentSharedContactCount, proposalCount, contactRequestCount, failedPaymentCount] = await Promise.all([
    prisma.contactInfo.count({ where: sharedContactWhere }),
    prisma.contactInfo.count({ where: { ...sharedContactWhere, profile: { createdAt: { gte: new Date(Date.now() - WINDOW_1H_MS) } } } }),
    prisma.proposal.count({ where: { OR: [{ profileAId: profileId }, { profileBId: profileId }], createdAt: { gte: since } } }),
    prisma.contactPermission.count({ where: { profileId, requestedAt: { gte: since } } }),
    prisma.payment.count({ where: { profileId, status: "FAILED", createdAt: { gte: since } } }),
  ]);

  const definitions: SignalDefinition[] = [
    {
      flagType: "RAPID_REGISTRATION_SIGNAL",
      severity: "MEDIUM",
      triggered: detectRapidRegistration(recentSharedContactCount + 1),
      description: `${recentSharedContactCount} other profile(s) sharing this profile's mobile number or email were registered within the last hour.`,
    },
    {
      flagType: "CONTACT_REUSE_SIGNAL",
      severity: "MEDIUM",
      triggered: detectContactReuse(sharedContactCount + 1),
      description: `This profile's mobile number or email is shared with ${sharedContactCount} other profile(s).`,
    },
    {
      flagType: "EXCESSIVE_PROPOSAL_ACTIVITY",
      severity: "LOW",
      triggered: detectExcessiveProposalActivity(proposalCount),
      description: `${proposalCount} proposal(s) involving this profile in the last 24 hours.`,
    },
    {
      flagType: "ABNORMAL_CONTACT_REQUEST_ACTIVITY",
      severity: "MEDIUM",
      triggered: detectAbnormalContactRequestActivity(contactRequestCount),
      description: `${contactRequestCount} contact-sharing request(s) from this profile in the last 24 hours.`,
    },
    {
      flagType: "PAYMENT_ANOMALY_SIGNAL",
      severity: "MEDIUM",
      triggered: detectPaymentAnomaly(failedPaymentCount),
      description: `${failedPaymentCount} failed payment attempt(s) from this profile in the last 24 hours.`,
    },
  ];

  let signalsCreated = 0;
  for (const def of definitions) {
    if (await raiseSignalIfNew(profileId, def)) signalsCreated++;
  }

  return { profilesScanned: 1, signalsCreated };
}
