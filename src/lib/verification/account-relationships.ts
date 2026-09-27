import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import type { AccountRelationshipType, DuplicateConfidenceBand, DuplicateCandidateStatus } from "@prisma/client";

export class AccountRelationshipError extends HttpError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "AccountRelationshipError";
  }
}

// Manually creatable by an admin (relationships:create) for the relationship
// types that aren't the automatic by-product of a duplicate review — spec
// §15. Upserts on the natural key so re-recording the same relationship
// (e.g. re-confirming) never creates a second row.
export async function createRelationship(params: {
  profileId: string;
  relatedProfileId: string;
  relationshipType: AccountRelationshipType;
  confidenceBand?: DuplicateConfidenceBand;
  source: string;
  evidenceRef?: string;
  notes?: string;
  createdById: string;
}) {
  const relationship = await prisma.accountRelationship.upsert({
    where: {
      profileId_relatedProfileId_relationshipType: {
        profileId: params.profileId,
        relatedProfileId: params.relatedProfileId,
        relationshipType: params.relationshipType,
      },
    },
    update: { status: "ACTIVE", confidenceBand: params.confidenceBand ?? null, source: params.source, evidenceRef: params.evidenceRef ?? null, notes: params.notes ?? null },
    create: {
      profileId: params.profileId,
      relatedProfileId: params.relatedProfileId,
      relationshipType: params.relationshipType,
      confidenceBand: params.confidenceBand ?? null,
      source: params.source,
      evidenceRef: params.evidenceRef ?? null,
      notes: params.notes ?? null,
      createdById: params.createdById,
    },
  });

  await writeAudit({
    action: "ACCOUNT_RELATIONSHIP_CREATED",
    adminId: params.createdById,
    targetProfileId: params.profileId,
    meta: { relatedProfileId: params.relatedProfileId, relationshipType: params.relationshipType },
  });

  return relationship;
}

export async function getRelationshipsForProfile(profileId: string) {
  return prisma.accountRelationship.findMany({
    where: { OR: [{ profileId }, { relatedProfileId: profileId }], status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
}

// The single function that atomically resolves a DuplicateCandidate,
// resolves its companion SecurityFlag (if any), and records the resulting
// AccountRelationship — so the flag/candidate/relationship three-way never
// drift out of sync with each other (plan decision 3/8). NOT_DUPLICATE
// records an UNKNOWN_RELATIONSHIP row specifically so an already-cleared
// pair is never re-flagged by a later duplicate scan.
export async function resolveDuplicateCandidate(
  candidateId: string,
  opts: { adminId: string; decision: Extract<DuplicateCandidateStatus, "CONFIRMED_DUPLICATE" | "NOT_DUPLICATE">; resolution: string }
) {
  const updated = await prisma.$transaction(async (tx) => {
    const candidate = await tx.duplicateCandidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new AccountRelationshipError(404, "Duplicate candidate not found.");
    if (candidate.status === "CONFIRMED_DUPLICATE" || candidate.status === "NOT_DUPLICATE" || candidate.status === "RESOLVED") {
      throw new AccountRelationshipError(409, "This duplicate candidate has already been reviewed.");
    }

    const row = await tx.duplicateCandidate.update({
      where: { id: candidateId },
      data: { status: opts.decision, reviewerId: opts.adminId, reviewedAt: new Date(), resolution: opts.resolution },
    });

    if (candidate.securityFlagId) {
      await tx.securityFlag.update({
        where: { id: candidate.securityFlagId },
        data: { status: "RESOLVED", resolution: opts.resolution, resolvedById: opts.adminId, resolvedAt: new Date() },
      });
    }

    const relationshipType: AccountRelationshipType = opts.decision === "CONFIRMED_DUPLICATE" ? "CONFIRMED_DUPLICATE" : "UNKNOWN_RELATIONSHIP";
    await tx.accountRelationship.upsert({
      where: {
        profileId_relatedProfileId_relationshipType: { profileId: candidate.profileId, relatedProfileId: candidate.candidateProfileId, relationshipType },
      },
      update: { status: "ACTIVE", confidenceBand: candidate.confidenceBand, source: "duplicate_review", evidenceRef: candidate.id, reviewedById: opts.adminId, reviewedAt: new Date() },
      create: {
        profileId: candidate.profileId,
        relatedProfileId: candidate.candidateProfileId,
        relationshipType,
        confidenceBand: candidate.confidenceBand,
        source: "duplicate_review",
        evidenceRef: candidate.id,
        createdById: opts.adminId,
        reviewedById: opts.adminId,
        reviewedAt: new Date(),
      },
    });

    return row;
  });

  await writeAudit({
    action: opts.decision === "CONFIRMED_DUPLICATE" ? "DUPLICATE_CONFIRMED" : "DUPLICATE_DISMISSED",
    adminId: opts.adminId,
    targetProfileId: updated.profileId,
    meta: { candidateId, candidateProfileId: updated.candidateProfileId },
  });

  return updated;
}
