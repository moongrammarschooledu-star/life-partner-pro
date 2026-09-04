import { prisma } from "@/lib/prisma";
import type { Proposal } from "@prisma/client";

// Human-readable display id only (spec §2 — never expose internal cuids to
// applicants). Mirrors src/lib/profile-code.ts's atomic-counter pattern.
export async function nextProposalCode(): Promise<string> {
  const counter = await prisma.proposalCodeCounter.upsert({
    where: { id: 1 },
    update: { lastSeq: { increment: 1 } },
    create: { id: 1, lastSeq: 1 },
  });
  return `LPP-RP-${String(counter.lastSeq).padStart(6, "0")}`;
}

// proposalCode is nullable because it was added to a table that already had
// rows (see prisma/schema.prisma comment on Proposal.proposalCode) — this
// lazily backfills any pre-existing proposal the first time it's read,
// rather than requiring a one-off migration script.
export async function ensureProposalCode(proposal: Pick<Proposal, "id" | "proposalCode">): Promise<string> {
  if (proposal.proposalCode) return proposal.proposalCode;
  const code = await nextProposalCode();
  await prisma.proposal.update({ where: { id: proposal.id }, data: { proposalCode: code } });
  return code;
}
