import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { suggestProposalResponse, FamilyDecisionError } from "@/lib/family/decisions";
import type { FamilyDecisionValue } from "@prisma/client";

const VALID: FamilyDecisionValue[] = ["INTERESTED", "NOT_INTERESTED", "NEED_MORE_INFO"];

// "You are responding as an authorized family representative" (spec §21) —
// this NEVER writes a real ProposalResponse; it always creates a
// FamilyDecision awaiting the applicant's own confirmation (Decision 8).
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { code } = await params;
  const { decision, comment } = await req.json();
  if (!VALID.includes(decision)) return NextResponse.json({ error: "A valid decision is required." }, { status: 400 });

  const proposal = await prisma.proposal.findUnique({ where: { proposalCode: code.trim().toUpperCase() }, select: { id: true } });
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });

  try {
    const row = await suggestProposalResponse({ familyMemberId, proposalId: proposal.id, decision, comment });
    return NextResponse.json({ id: row.id, decisionCode: row.decisionCode, status: row.status });
  } catch (error) {
    if (error instanceof FamilyDecisionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
