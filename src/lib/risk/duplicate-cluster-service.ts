import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { notifyAdmins } from "@/lib/notifications/notification-service";
import { findDuplicateSignals, type DuplicateCandidateProfile } from "@/lib/verification/duplicate-detection";
import { assertNoSensitiveTraits } from "@/lib/risk/config";
import { createRiskSignal, suppressedRelatedProfiles } from "@/lib/risk/signal-service";
import type { SessionAdmin } from "@/lib/route-guard";
import type { AccountRelationshipType, DuplicateConfidenceBand, DuplicateCluster, FalsePositiveReason } from "@prisma/client";

// DuplicateDetectionService (cluster layer). Detection uses ONLY the evidence
// fields in the allow-list below — contact identifiers, name+DOB, and verified
// provider references. Religion, ethnicity, family background, income,
// appearance/photo similarity and similar traits can never become evidence:
// `assertAllowedDuplicateSignals` rejects them, and tests pin that.

export const DUPLICATE_ALLOWED_SIGNALS = ["MOBILE", "EMAIL", "NAME_AND_DOB", "VERIFIED_PHONE", "VERIFIED_EMAIL", "PROVIDER_REFERENCE"] as const;
export type ExtendedDuplicateSignal = (typeof DUPLICATE_ALLOWED_SIGNALS)[number];

export function assertAllowedDuplicateSignals(signals: string[]): void {
  assertNoSensitiveTraits(signals, "Duplicate evidence");
  const unknown = signals.filter((s) => !(DUPLICATE_ALLOWED_SIGNALS as readonly string[]).includes(s));
  if (unknown.length) throw new HttpError(422, `Unsupported duplicate evidence: ${unknown.join(", ")}.`);
}

const WEIGHTS: Record<ExtendedDuplicateSignal, number> = { MOBILE: 35, EMAIL: 35, NAME_AND_DOB: 30, VERIFIED_PHONE: 10, VERIFIED_EMAIL: 10, PROVIDER_REFERENCE: 60 };

export function bandFromScore(score: number): DuplicateConfidenceBand {
  if (score >= 95) return "EXACT";
  if (score >= 80) return "VERY_HIGH";
  if (score >= 65) return "HIGH";
  if (score >= 30) return "MEDIUM";
  return "LOW";
}

const BAND_ORDER: DuplicateConfidenceBand[] = ["LOW", "MEDIUM", "STRONG", "HIGH", "VERY_HIGH", "EXACT"];
export function maxBand(a: DuplicateConfidenceBand, b: DuplicateConfidenceBand): DuplicateConfidenceBand {
  return BAND_ORDER.indexOf(a) >= BAND_ORDER.indexOf(b) ? a : b;
}

export function computeExtendedConfidence(signals: ExtendedDuplicateSignal[]): { score: number; band: DuplicateConfidenceBand } {
  assertAllowedDuplicateSignals(signals);
  const score = Math.min(100, signals.reduce((sum, s) => sum + WEIGHTS[s], 0));
  return { score, band: bandFromScore(score) };
}

// ---------- pure clustering (union-find over pair edges) ----------

export interface DuplicateEdge {
  a: string;
  b: string;
  band: DuplicateConfidenceBand;
  confirmed?: boolean;
}

export interface ClusterDraft {
  members: string[];
  band: DuplicateConfidenceBand;
  confirmed: boolean;
  fingerprint: string;
}

export function clusterFingerprint(memberIds: string[]): string {
  return createHash("sha256").update([...memberIds].sort().join("|")).digest("hex");
}

export function buildClusters(edges: DuplicateEdge[]): ClusterDraft[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  for (const e of edges) {
    if (e.a === e.b) continue;
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map<string, { members: Set<string>; band: DuplicateConfidenceBand; confirmed: boolean }>();
  for (const e of edges) {
    if (e.a === e.b) continue;
    const root = find(e.a);
    const g = groups.get(root) ?? { members: new Set<string>(), band: "LOW" as DuplicateConfidenceBand, confirmed: false };
    g.members.add(e.a);
    g.members.add(e.b);
    g.band = maxBand(g.band, e.band);
    g.confirmed = g.confirmed || e.confirmed === true;
    groups.set(root, g);
  }
  return [...groups.values()]
    .filter((g) => g.members.size >= 2)
    .map((g) => {
      const members = [...g.members].sort();
      return { members, band: g.band, confirmed: g.confirmed, fingerprint: clusterFingerprint(members) };
    });
}

const OPEN_CANDIDATE = ["POTENTIAL_DUPLICATE", "DUPLICATE_REVIEW_REQUIRED"] as const;
const SUPPRESSING: AccountRelationshipType[] = ["AUTHORIZED_FAMILY_ACCOUNT", "FAMILY_RELATED", "UNKNOWN_RELATIONSHIP"];
const DUPLICATE_EDGE_TYPES: AccountRelationshipType[] = ["POTENTIAL_DUPLICATE", "LIKELY_DUPLICATE", "CONFIRMED_DUPLICATE"];

// Idempotent rebuild: identical membership → identical fingerprint → the same
// row is kept. A cluster whose membership changed supersedes the old
// UNRESOLVED row rather than editing it in place.
export async function rebuildDuplicateClusters(actorId?: string | null): Promise<{ clusters: number; created: number; superseded: number }> {
  const [candidates, relationships, suppress] = await Promise.all([
    prisma.duplicateCandidate.findMany({ where: { status: { in: [...OPEN_CANDIDATE] } }, select: { profileId: true, candidateProfileId: true, confidenceBand: true } }),
    prisma.accountRelationship.findMany({ where: { status: "ACTIVE", relationshipType: { in: DUPLICATE_EDGE_TYPES } }, select: { profileId: true, relatedProfileId: true, relationshipType: true, confidenceBand: true } }),
    prisma.accountRelationship.findMany({ where: { status: "ACTIVE", relationshipType: { in: SUPPRESSING } }, select: { profileId: true, relatedProfileId: true } }),
  ]);
  const suppressed = new Set(suppress.flatMap((s) => [`${s.profileId}|${s.relatedProfileId}`, `${s.relatedProfileId}|${s.profileId}`]));

  const edges: DuplicateEdge[] = [];
  for (const c of candidates) edges.push({ a: c.profileId, b: c.candidateProfileId, band: c.confidenceBand });
  for (const r of relationships) edges.push({ a: r.profileId, b: r.relatedProfileId, band: r.confidenceBand ?? "MEDIUM", confirmed: r.relationshipType === "CONFIRMED_DUPLICATE" });
  const usable = edges.filter((e) => !suppressed.has(`${e.a}|${e.b}`));

  const drafts = buildClusters(usable);
  const fingerprints = new Set(drafts.map((d) => d.fingerprint));

  let created = 0;
  for (const draft of drafts) {
    const existing = await prisma.duplicateCluster.findUnique({ where: { fingerprint: draft.fingerprint } });
    if (existing) continue;
    await prisma.duplicateCluster.create({
      data: {
        fingerprint: draft.fingerprint,
        status: draft.confirmed ? "CONFIRMED" : "UNRESOLVED",
        confidenceBand: draft.band,
        memberCount: draft.members.length,
        members: { create: draft.members.map((profileId) => ({ profileId })) },
      },
    });
    created++;
  }

  const stale = await prisma.duplicateCluster.findMany({ where: { status: "UNRESOLVED" }, select: { id: true, fingerprint: true } });
  const staleIds = stale.filter((c) => !fingerprints.has(c.fingerprint)).map((c) => c.id);
  if (staleIds.length) await prisma.duplicateCluster.updateMany({ where: { id: { in: staleIds } }, data: { status: "SUPERSEDED" } });

  await writeAudit({ action: "RISK_DUPLICATE_CLUSTER_REBUILT", adminId: actorId ?? null, meta: { clusters: drafts.length, created, superseded: staleIds.length } });
  if (created > 0) await notifyAdmins({ type: "DUPLICATE_REVIEW_REQUIRED", data: {}, roles: ["VERIFICATION_MANAGER"] });
  return { clusters: drafts.length, created, superseded: staleIds.length };
}

export async function listDuplicateClusters(filter: { status?: string; take?: number } = {}) {
  return prisma.duplicateCluster.findMany({
    where: filter.status ? { status: filter.status as DuplicateCluster["status"] } : {},
    include: { members: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(filter.take ?? 50, 200),
  });
}

// ---------- per-profile detection (real-time / batch) ----------

// Detects duplicates for ONE profile without a full-table scan: candidates are
// found by indexed contact / name+DOB lookups. Reviewed pairs (confirmed,
// "not a duplicate", authorized family) are never re-flagged.
export async function evaluateProfileDuplicates(profileId: string): Promise<{ signalsCreated: number; profileId: string }> {
  const profile = await prisma.profile.findUnique({ where: { id: profileId }, include: { contact: true } });
  if (!profile || !profile.contact || profile.softDeleted) return { signalsCreated: 0, profileId };

  const sameContact = await prisma.contactInfo.findMany({
    where: { profileId: { not: profileId }, OR: [{ mobileNumber: profile.contact.mobileNumber }, { email: { equals: profile.contact.email, mode: "insensitive" } }] },
    include: { profile: { select: { id: true, fullName: true, dateOfBirth: true, softDeleted: true } } },
    take: 25,
  });
  const sameNameDob = await prisma.profile.findMany({
    where: { id: { not: profileId }, softDeleted: false, dateOfBirth: profile.dateOfBirth, fullName: { equals: profile.fullName, mode: "insensitive" } },
    include: { contact: true },
    take: 25,
  });

  const toCandidate = (id: string, fullName: string, dob: Date, mobile: string, email: string): DuplicateCandidateProfile => ({ id, fullName, dateOfBirth: dob.toISOString(), mobileNumber: mobile, email });
  const self = toCandidate(profile.id, profile.fullName, profile.dateOfBirth, profile.contact.mobileNumber, profile.contact.email);
  const pool = new Map<string, DuplicateCandidateProfile>();
  for (const c of sameContact) if (!c.profile.softDeleted) pool.set(c.profileId, toCandidate(c.profileId, c.profile.fullName, c.profile.dateOfBirth, c.mobileNumber, c.email));
  for (const p of sameNameDob) if (p.contact) pool.set(p.id, toCandidate(p.id, p.fullName, p.dateOfBirth, p.contact.mobileNumber, p.contact.email));

  const matches = findDuplicateSignals(self, [...pool.values()]);
  if (matches.length === 0) return { signalsCreated: 0, profileId };

  const explained = await suppressedRelatedProfiles(profileId, matches.map((m) => m.candidateId));
  let signalsCreated = 0;
  for (const match of matches) {
    if (explained.has(match.candidateId)) continue;
    const [aId, bId] = [profileId, match.candidateId].sort();

    const reviewed = await prisma.accountRelationship.findFirst({
      where: { status: "ACTIVE", relationshipType: { in: ["CONFIRMED_DUPLICATE", "UNKNOWN_RELATIONSHIP"] }, OR: [{ profileId: aId, relatedProfileId: bId }, { profileId: bId, relatedProfileId: aId }] },
      select: { id: true },
    });
    if (reviewed) continue;
    const reverse = await prisma.securityFlag.findFirst({ where: { flagType: "DUPLICATE_PROFILE_SUSPECTED", status: { in: ["OPEN", "INVESTIGATING", "ACKNOWLEDGED", "ESCALATED"] }, profileId: match.candidateId, relatedProfileId: profileId }, select: { id: true } });
    if (reverse) continue;

    const signals = match.signals as ExtendedDuplicateSignal[];
    const { score, band } = computeExtendedConfidence(signals);
    const result = await createRiskSignal({
      profileId,
      relatedProfileId: match.candidateId,
      flagType: "DUPLICATE_PROFILE_SUSPECTED",
      ruleKey: "duplicate_detection",
      description: `Possible duplicate detected via: ${signals.join(", ")}.`,
      severity: signals.includes("MOBILE") || signals.includes("EMAIL") ? "HIGH" : "MEDIUM",
      confidence: band === "EXACT" ? "EXACT" : band === "VERY_HIGH" ? "VERY_HIGH" : band === "HIGH" ? "HIGH" : band === "MEDIUM" ? "MEDIUM" : "LOW",
      source: "duplicate-detection",
      notifyAsDuplicate: true,
    });
    if (!result.created) continue;
    await prisma.duplicateCandidate.create({
      data: {
        candidateCode: await nextSequenceCode("DUPC"),
        profileId: aId,
        candidateProfileId: bId,
        securityFlagId: result.flag.id,
        confidenceBand: band,
        confidenceScore: score,
        matchingSignals: JSON.stringify(signals),
      },
    });
    signalsCreated++;
  }
  return { signalsCreated, profileId };
}

// ---------- human resolution ----------

const FAMILY_REASONS: FalsePositiveReason[] = ["SHARED_FAMILY_DEVICE", "SHARED_FAMILY_PHONE", "SHARED_HOME_NETWORK"];

export async function resolveDuplicateCluster(
  clusterId: string,
  actor: SessionAdmin,
  params: { decision: "CONFIRMED" | "FALSE_POSITIVE" | "RESOLVED"; note: string; falsePositiveReason?: FalsePositiveReason }
): Promise<{ approvalRequired: false; cluster: DuplicateCluster } | { approvalRequired: true; approvalCode: string; status: string }> {
  if (params.note.trim().length < 5) throw new HttpError(422, "A resolution note is required.");
  const cluster = await prisma.duplicateCluster.findUnique({ where: { id: clusterId }, include: { members: true } });
  if (!cluster) throw new HttpError(404, "Duplicate cluster not found.");
  if (["FALSE_POSITIVE", "RESOLVED", "SUPERSEDED"].includes(cluster.status)) throw new HttpError(409, "This cluster is already closed.");
  const ids = cluster.members.map((m) => m.profileId).sort();

  if (params.decision === "FALSE_POSITIVE") {
    if (!params.falsePositiveReason) throw new HttpError(422, "A structured false-positive reason is required.");
    // Record why, so the pair is never re-flagged: family context → authorized
    // family account; anything else → explicit "not a duplicate".
    const relationshipType: AccountRelationshipType = FAMILY_REASONS.includes(params.falsePositiveReason) ? "AUTHORIZED_FAMILY_ACCOUNT" : "UNKNOWN_RELATIONSHIP";
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await prisma.accountRelationship.upsert({
          where: { profileId_relatedProfileId_relationshipType: { profileId: ids[i], relatedProfileId: ids[j], relationshipType } },
          update: { status: "ACTIVE", source: "duplicate_cluster_review", reviewedById: actor.id, reviewedAt: new Date(), notes: params.note.trim() },
          create: { profileId: ids[i], relatedProfileId: ids[j], relationshipType, source: "duplicate_cluster_review", createdById: actor.id, reviewedById: actor.id, reviewedAt: new Date(), notes: params.note.trim() },
        });
      }
    }
    await prisma.duplicateCandidate.updateMany({
      where: { status: { in: [...OPEN_CANDIDATE] }, profileId: { in: ids }, candidateProfileId: { in: ids } },
      data: { status: "NOT_DUPLICATE", reviewerId: actor.id, reviewedAt: new Date(), resolution: params.note.trim(), falsePositiveReason: params.falsePositiveReason },
    });
    const updated = await prisma.duplicateCluster.update({ where: { id: clusterId }, data: { status: "FALSE_POSITIVE", resolvedAt: new Date(), resolvedById: actor.id } });
    await writeAudit({ action: "DUPLICATE_DISMISSED", adminId: actor.id, targetProfileId: ids[0], meta: { clusterId, reason: params.falsePositiveReason } });
    return { approvalRequired: false, cluster: updated };
  }

  if (params.decision === "CONFIRMED") {
    const gate = await enforceApprovalGate({ actionType: "DUPLICATE_CONFIRMATION", sourceType: "PROFILE", sourceId: ids[0], actor, reason: params.note.trim(), requestedPayload: { clusterId, members: ids } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    const updated = await prisma.duplicateCluster.update({ where: { id: clusterId }, data: { status: "CONFIRMED", resolvedAt: new Date(), resolvedById: actor.id } });
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        await prisma.accountRelationship.upsert({
          where: { profileId_relatedProfileId_relationshipType: { profileId: ids[i], relatedProfileId: ids[j], relationshipType: "CONFIRMED_DUPLICATE" } },
          update: { status: "ACTIVE", reviewedById: actor.id, reviewedAt: new Date() },
          create: { profileId: ids[i], relatedProfileId: ids[j], relationshipType: "CONFIRMED_DUPLICATE", source: "duplicate_cluster_review", createdById: actor.id, reviewedById: actor.id, reviewedAt: new Date(), notes: params.note.trim() },
        });
      }
    }
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
    await writeAudit({ action: "DUPLICATE_CONFIRMED", adminId: actor.id, targetProfileId: ids[0], meta: { clusterId } });
    return { approvalRequired: false, cluster: updated };
  }

  const updated = await prisma.duplicateCluster.update({ where: { id: clusterId }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: actor.id } });
  return { approvalRequired: false, cluster: updated };
}

// ---------- merge PLANNING (never execution) ----------

export interface MergePlan {
  clusterId: string;
  suggestedSurvivorId: string;
  members: Array<{ profileId: string; verified: boolean; createdAt: string; proposals: number; cases: number; payments: number; verificationDocuments: number; activeHold: boolean }>;
  preservationChecklist: string[];
  blockedReason: string | null;
  approval: { approvalCode: string; status: string } | null;
}

export async function planDuplicateMerge(clusterId: string, actor: SessionAdmin, reason: string): Promise<MergePlan> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const cluster = await prisma.duplicateCluster.findUnique({ where: { id: clusterId }, include: { members: true } });
  if (!cluster) throw new HttpError(404, "Duplicate cluster not found.");
  if (cluster.status !== "CONFIRMED") throw new HttpError(409, "Only a human-CONFIRMED duplicate cluster can be planned for merge.");

  const members: MergePlan["members"] = [];
  for (const m of cluster.members) {
    const [profile, proposals, cases, payments, docs, hold] = await Promise.all([
      prisma.profile.findUnique({ where: { id: m.profileId }, select: { verified: true, createdAt: true } }),
      prisma.proposal.count({ where: { OR: [{ profileAId: m.profileId }, { profileBId: m.profileId }] } }),
      prisma.case.count({ where: { OR: [{ reporterProfileId: m.profileId }, { reportedProfileId: m.profileId }] } }),
      prisma.payment.count({ where: { profileId: m.profileId } }),
      prisma.verificationDocument.count({ where: { profileId: m.profileId } }),
      prisma.dataHold.findFirst({ where: { active: true, profileId: m.profileId }, select: { id: true } }),
    ]);
    members.push({ profileId: m.profileId, verified: profile?.verified ?? false, createdAt: (profile?.createdAt ?? new Date(0)).toISOString(), proposals, cases, payments, verificationDocuments: docs, activeHold: !!hold });
  }
  // Suggest a survivor: verified first, then the oldest account. A suggestion only.
  const ranked = [...members].sort((a, b) => Number(b.verified) - Number(a.verified) || a.createdAt.localeCompare(b.createdAt));
  const blockedReason = members.some((m) => m.activeHold) ? "An active legal hold covers a member account; a merge cannot be planned until the hold is released." : null;

  let approval: MergePlan["approval"] = null;
  if (!blockedReason) {
    const gate = await enforceApprovalGate({ actionType: "DUPLICATE_MERGE", sourceType: "PROFILE", sourceId: ranked[0].profileId, actor, reason: reason.trim(), requestedPayload: { clusterId, survivor: ranked[0].profileId, members: members.map((m) => m.profileId) } });
    if (gate.requiresApproval) approval = { approvalCode: gate.approvalCode, status: gate.status };
  }
  await writeAudit({ action: "RISK_CASE_ACTION", adminId: actor.id, targetProfileId: ranked[0].profileId, meta: { clusterId, action: "MERGE_PLANNED", blocked: !!blockedReason } });

  return {
    clusterId,
    suggestedSurvivorId: ranked[0].profileId,
    members,
    blockedReason,
    approval,
    preservationChecklist: [
      "Preserve the full audit trail of every member account.",
      "Preserve consent and privacy-request records with their original timestamps.",
      "Re-point proposals, cases and payments to the surviving account without altering their history.",
      "Keep verification documents and results of every member; never discard the older record.",
      "Confirm no legal hold or open safety case covers any member before merging.",
      "The data merge itself is performed manually by an authorised reviewer after approval — this plan does not execute it.",
    ],
  };
}
