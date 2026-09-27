import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { createRelationship } from "@/lib/verification/account-relationships";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { AccountRelationshipType } from "@prisma/client";

const VALID_TYPES: AccountRelationshipType[] = ["FAMILY_RELATED", "AUTHORIZED_FAMILY_ACCOUNT", "SHARED_CONTACT_SIGNAL", "SHARED_VERIFICATION_SIGNAL"];

// Manually records an account relationship for a duplicate candidate pair
// without going through the confirm/dismiss binary — e.g. "these are
// authorized family accounts, not a duplicate" (spec §15).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("duplicates:link");
    const { id } = await params;
    const { relationshipType, notes } = (await req.json()) as { relationshipType?: string; notes?: string };

    if (!relationshipType || !VALID_TYPES.includes(relationshipType as AccountRelationshipType)) {
      throw new ApiError(400, "A valid relationshipType is required.");
    }

    const candidate = await prisma.duplicateCandidate.findUnique({ where: { id } });
    if (!candidate) throw new ApiError(404, "Duplicate candidate not found");

    const gate = await enforceApprovalGate({
      actionType: "ACCOUNT_RELATIONSHIP_LINK",
      sourceType: "PROFILE",
      sourceId: candidate.profileId,
      actor: admin,
      reason: notes?.trim() || `Linked as ${relationshipType}`,
      requestedPayload: { candidateId: id, profileId: candidate.profileId, relatedProfileId: candidate.candidateProfileId, relationshipType },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
      return NextResponse.json({ approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status }, { status: 202 });
    }

    const relationship = await createRelationship({
      profileId: candidate.profileId,
      relatedProfileId: candidate.candidateProfileId,
      relationshipType: relationshipType as AccountRelationshipType,
      confidenceBand: candidate.confidenceBand,
      source: "admin_manual",
      evidenceRef: candidate.id,
      notes: notes?.trim() || undefined,
      createdById: admin.id,
    });

    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, admin.id);

    return NextResponse.json(relationship);
  } catch (error) {
    return handleApiError(error);
  }
}
