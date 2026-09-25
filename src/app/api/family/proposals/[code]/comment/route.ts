import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireFamilyMemberId } from "@/lib/family/require-family-member";
import { canComment } from "@/lib/family/access-control";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const familyMemberId = await requireFamilyMemberId();
  if (!familyMemberId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { code } = await params;
  const { body, visibility } = await req.json();
  if (typeof body !== "string" || !body.trim()) {
    return NextResponse.json({ error: "A comment body is required." }, { status: 400 });
  }

  const proposal = await prisma.proposal.findUnique({ where: { proposalCode: code.trim().toUpperCase() }, select: { id: true } });
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });

  const allowed = await canComment(familyMemberId, "PROPOSAL", proposal.id);
  if (!allowed) return NextResponse.json({ error: "You don't have permission to comment on this proposal." }, { status: 403 });

  const comment = await prisma.familyComment.create({
    data: {
      familyMemberId,
      commentType: "PROPOSAL_COMMENT",
      targetType: "PROPOSAL",
      targetId: proposal.id,
      body: body.trim(),
      visibility: visibility === "FAMILY_SHARED" ? "FAMILY_SHARED" : "APPLICANT_ONLY",
    },
  });

  await writeAudit({ action: "FAMILY_COMMENT_ADDED", actorFamilyMemberId: familyMemberId, meta: { proposalId: proposal.id } });

  return NextResponse.json({ id: comment.id });
}
