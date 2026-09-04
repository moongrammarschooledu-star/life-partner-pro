import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { nextProposalStatus } from "@/lib/proposal-workflow";
import { writeAudit } from "@/lib/audit";
import type { ProposalResponseType, ProposalDeclineReason } from "@prisma/client";

const VALID_RESPONSES: ProposalResponseType[] = ["INTERESTED", "NOT_INTERESTED", "NEED_MORE_INFO"];
const VALID_REASONS: ProposalDeclineReason[] = [
  "DIFFERENT_EXPECTATIONS",
  "LOCATION",
  "AGE",
  "EDUCATION",
  "PROFESSION",
  "FAMILY_PREFERENCE",
  "PERSONAL_PREFERENCE",
  "OTHER",
];

// Addressed by proposalCode, never the raw cuid (spec §2 — never expose
// internal database UUIDs to normal users). Rate-limited the same way
// /api/my-status's POST is — a signed cookie proves identity but doesn't by
// itself stop response-spam from a shared/compromised browser.
export async function POST(req: Request) {
  const key = `my-proposals-respond:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 20, 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
  }

  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const me = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, softDeleted: true } });
  if (!me || me.softDeleted) return NextResponse.json({ error: "Not found." }, { status: 401 });

  try {
    const { proposalCode, response, reason, reasonNote } = await req.json();
    if (typeof proposalCode !== "string" || !VALID_RESPONSES.includes(response)) {
      return NextResponse.json({ error: "A valid proposal and response are required." }, { status: 400 });
    }
    if (reason && !VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: "Invalid reason." }, { status: 400 });
    }

    const proposal = await prisma.proposal.findUnique({ where: { proposalCode: proposalCode.trim().toUpperCase() } });
    if (!proposal || (proposal.profileAId !== profileId && proposal.profileBId !== profileId)) {
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }

    await prisma.proposalResponse.upsert({
      where: { proposalId_profileId: { proposalId: proposal.id, profileId } },
      update: { response, reason: reason || null, reasonNote: reasonNote || null, respondedAt: new Date() },
      create: { proposalId: proposal.id, profileId, response, reason: reason || null, reasonNote: reasonNote || null },
    });

    const [responseA, responseB] = await Promise.all([
      prisma.proposalResponse.findUnique({ where: { proposalId_profileId: { proposalId: proposal.id, profileId: proposal.profileAId } } }),
      prisma.proposalResponse.findUnique({ where: { proposalId_profileId: { proposalId: proposal.id, profileId: proposal.profileBId } } }),
    ]);
    const newStatus = nextProposalStatus(proposal.status, responseA?.response, responseB?.response);

    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: newStatus, events: { create: { status: newStatus, performedByProfileId: profileId } } },
    });

    await writeAudit({ action: "PROPOSAL_RESPONSE_SUBMITTED", targetProfileId: profileId, meta: { proposalId: proposal.id, response } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
