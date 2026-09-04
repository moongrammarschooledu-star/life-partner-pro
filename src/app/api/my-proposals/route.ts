import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { ensureProposalCode } from "@/lib/proposal-code";
import { APPLICANT_STATUS_LABEL } from "@/lib/proposal-status-labels";
import { deriveApplicantHighlights } from "@/lib/proposal-workflow";
import { calculateAge } from "@/lib/utils";
import { thresholdsFromSettings, DEFAULT_THRESHOLDS, type MatchThresholds } from "@/lib/matching";

function tierLabelFor(total: number, thresholds: MatchThresholds): string {
  if (total >= thresholds.excellent) return "Excellent Match";
  if (total >= thresholds.veryGood) return "Very Good Match";
  if (total >= thresholds.good) return "Good Match";
  if (total >= thresholds.possible) return "Possible Match";
  return "Low Compatibility";
}

// Deliberately narrow (spec §5/§26): never contact info, admin notes,
// internal rejection notes, staff identity, raw per-category numeric
// scores, or the other profile's photos. Mirrors /api/my-status's
// cookie-verification pattern exactly — re-checks the profile still exists
// and isn't soft-deleted rather than trusting the cookie payload alone.
export async function GET() {
  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const me = await prisma.profile.findUnique({ where: { id: profileId }, select: { id: true, softDeleted: true } });
  if (!me || me.softDeleted) return NextResponse.json({ error: "Not found." }, { status: 401 });

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const thresholds = settings ? thresholdsFromSettings(settings) : DEFAULT_THRESHOLDS;

  const proposals = await prisma.proposal.findMany({
    where: { OR: [{ profileAId: profileId }, { profileBId: profileId }] },
    include: {
      profileA: { include: { education: true, profession: true, family: true } },
      profileB: { include: { education: true, profession: true, family: true } },
      match: true,
      responses: { where: { profileId } },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = await Promise.all(
    proposals.map(async (p) => {
      const isA = p.profileAId === profileId;
      const other = isA ? p.profileB : p.profileA;
      const myResponse = p.responses[0] ?? null;
      const breakdown = p.match ? (JSON.parse(p.match.breakdown) as { category: string; status: "compatible" | "partial" | "incompatible" | "unknown" }[]) : [];
      const { highlights, differences } = deriveApplicantHighlights(breakdown as never);

      return {
        proposalCode: await ensureProposalCode(p),
        createdAt: p.createdAt,
        status: APPLICANT_STATUS_LABEL[p.status],
        compatibilityScore: p.matchScore,
        compatibilityTier: p.matchScore != null ? tierLabelFor(p.matchScore, thresholds) : null,
        myResponse: myResponse?.response ?? null,
        otherProfile: {
          fullName: other.fullName,
          profileCode: other.profileCode,
          age: calculateAge(other.dateOfBirth),
          city: other.city,
          country: other.country,
          education: other.education?.level ?? null,
          profession: other.profession?.profession ?? null,
          maritalStatus: other.maritalStatus,
          familyType: other.family?.familyType ?? null,
        },
        highlights,
        differences,
      };
    })
  );

  return NextResponse.json({ items });
}
