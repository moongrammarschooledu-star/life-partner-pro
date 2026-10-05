import { prisma } from "@/lib/prisma";
import { lastTenDigits } from "@/lib/marketing/normalize";
import type { Lead } from "@prisma/client";

// STEP 29 §17 — marketing lead de-duplication. Deterministic identifiers only (provider lead id, E.164 phone hash,
// normalised email hash, plus a loose applicant match on the last 10 digits / email). It NEVER merges: a certain repeat
// (same phone AND same email hash on an existing lead) is recorded against that lead instead of creating a new one;
// anything uncertain becomes a new lead flagged DUPLICATE_REVIEW_REQUIRED for human review. Fails CLOSED — an error here
// propagates and nothing is created (the legacy STEP 28 check swallowed its own failures).

export type DedupVerdict =
  | { kind: "NONE" }
  | { kind: "EXACT_PROVIDER_LEAD"; existing: Lead }
  | { kind: "CERTAIN_REPEAT"; existing: Lead }
  | { kind: "POTENTIAL"; reasons: string[]; duplicateOfLeadId?: string };

export interface DedupInput {
  phoneHash: string | null;
  emailHash: string | null;
  phoneE164: string | null;
  email: string | null;
  platform?: string | null;
  providerLeadId?: string | null;
}

const IGNORED_STATUSES = ["INVALID", "ARCHIVED"] as const;

export async function checkLeadDuplicate(input: DedupInput): Promise<DedupVerdict> {
  if (input.platform && input.providerLeadId) {
    const byProvider = await prisma.lead.findUnique({ where: { platform_providerLeadId: { platform: input.platform, providerLeadId: input.providerLeadId } } });
    if (byProvider) return { kind: "EXACT_PROVIDER_LEAD", existing: byProvider };
  }

  const or: Array<Record<string, unknown>> = [];
  if (input.phoneHash) or.push({ phoneHash: input.phoneHash });
  if (input.emailHash) or.push({ emailHash: input.emailHash });

  const reasons: string[] = [];
  let duplicateOfLeadId: string | undefined;

  if (or.length) {
    const leads = await prisma.lead.findMany({
      where: { OR: or as never, status: { notIn: [...IGNORED_STATUSES] } },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    for (const l of leads) {
      const phoneMatch = !!input.phoneHash && l.phoneHash === input.phoneHash;
      const emailMatch = !!input.emailHash && l.emailHash === input.emailHash;
      // Certain: every identifier the new submission carries matches the SAME existing lead.
      const certain = (!input.phoneHash || phoneMatch) && (!input.emailHash || emailMatch) && (phoneMatch || emailMatch);
      if (certain) return { kind: "CERTAIN_REPEAT", existing: l };
    }
    const first = leads[0];
    if (first) {
      duplicateOfLeadId = first.id;
      reasons.push(first.phoneHash === input.phoneHash && input.phoneHash ? "PHONE_MATCHES_EXISTING_LEAD" : "EMAIL_MATCHES_EXISTING_LEAD");
    }
  }

  // Applicant match (loose by design — stored phone formats vary): last-10-digit suffix or case-insensitive email.
  const last10 = lastTenDigits(input.phoneE164);
  const profileOr: Array<Record<string, unknown>> = [];
  if (last10) profileOr.push({ contact: { mobileNumber: { endsWith: last10 } } }, { contact: { whatsappNumber: { endsWith: last10 } } });
  if (input.email) profileOr.push({ contact: { email: { equals: input.email, mode: "insensitive" } } });
  if (profileOr.length) {
    const profile = await prisma.profile.findFirst({ where: { OR: profileOr as never, softDeleted: false }, select: { id: true } });
    if (profile) reasons.push("MATCHES_EXISTING_APPLICANT");
  }

  return reasons.length ? { kind: "POTENTIAL", reasons, duplicateOfLeadId } : { kind: "NONE" };
}
