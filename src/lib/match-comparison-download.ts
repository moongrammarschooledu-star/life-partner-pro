import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { writeAudit } from "@/lib/audit";
import { buildProfilePdf, type ProfileDetailView } from "@/lib/profile-pdf";
import { comparisonSections, comparisonTable, type ComparisonRow } from "@/lib/match-comparison-pdf";
import { thresholdsFromSettings, DEFAULT_THRESHOLDS, type MatchThresholds } from "@/lib/matching";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/public-site/config";
import { calculateAge, formatEnumLabel } from "@/lib/utils";
import type { SessionAdmin as AdminSessionUser } from "@/lib/route-guard";

// The comparison of a match, shared by the Match page and the Proposal page: one loader (with the same access and "both verified" rules) and one PDF builder.
// The sheet carries both names and the safe summary of both sides, never a photo, contact detail, area, income or family detail.

function tierLabelFor(total: number, t: MatchThresholds): string {
  if (total >= t.excellent) return "Excellent Match";
  if (total >= t.veryGood) return "Very Good Match";
  if (total >= t.good) return "Good Match";
  if (total >= t.possible) return "Possible Match";
  return "Low Compatibility";
}

const matchInclude = { profileA: { include: profileDetailInclude }, profileB: { include: profileDetailInclude } };

type MatchRecord = NonNullable<Awaited<ReturnType<typeof findMatch>>>;
const findMatch = (where: { id: string } | { profileAId: string; profileBId: string }) => prisma.match.findFirst({ where, include: matchInclude });

/** The match record for a proposal: the one it was created from, otherwise the stored analysis of the same two people (in either order). */
export async function findMatchForPair(matchId: string | null, profileAId: string, profileBId: string): Promise<MatchRecord | null> {
  if (matchId) {
    const byId = await findMatch({ id: matchId });
    if (byId) return byId;
  }
  return (await findMatch({ profileAId, profileBId })) ?? (await findMatch({ profileAId: profileBId, profileBId: profileAId }));
}

export interface LoadedComparison {
  match: MatchRecord;
  youRecord: MatchRecord["profileA"];
  otherRecord: MatchRecord["profileA"];
  you: ProfileDetailView;
  other: ProfileDetailView;
  total: number;
  tierLabel: string;
  breakdown: ComparisonRow[];
}

/** Loads a match for ONE of its two people (`youProfileId`), after the access checks and the "both profiles verified" rule. */
export async function loadComparison(admin: AdminSessionUser, match: MatchRecord, youProfileId: string): Promise<LoadedComparison> {
  await assertProfileAssignmentAccess(admin, match.profileAId);
  await assertProfileAssignmentAccess(admin, match.profileBId);
  for (const p of [match.profileA, match.profileB]) {
    if (p.softDeleted || !p.verified) throw new ApiError(409, "A match comparison can only be used when both profiles are verified.");
  }
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const thresholds = settings ? thresholdsFromSettings(settings) : DEFAULT_THRESHOLDS;
  const youIsB = match.profileBId === youProfileId;
  const youRecord = youIsB ? match.profileB : match.profileA;
  const otherRecord = youIsB ? match.profileA : match.profileB;
  return {
    match,
    youRecord,
    otherRecord,
    you: toDetailDto(youRecord, admin.id, admin.permissions),
    other: toDetailDto(otherRecord, admin.id, admin.permissions),
    total: match.score,
    tierLabel: tierLabelFor(match.score, thresholds),
    breakdown: JSON.parse(match.breakdown) as ComparisonRow[],
  };
}

/** The same comparison as rows for the screen: the shared summary of both sides, side by side. */
export function comparisonForScreen(c: LoadedComparison) {
  return comparisonTable({ you: c.you, other: c.other, total: c.total, tierLabel: c.tierLabel, breakdown: c.breakdown });
}

/** The comparison sheet as a PDF (audited as a sensitive export). */
export async function buildComparisonDownload(admin: AdminSessionUser, c: LoadedComparison, origin: string, via: "MATCH" | "PROPOSAL", sourceId: string) {
  let logoPng: Uint8Array | null = null;
  try {
    const res = await fetch(new URL("/logo-icon.png", origin));
    if (res.ok) logoPng = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 200 }).png().toBuffer();
  } catch {
    logoPng = null;
  }

  const { youRecord, otherRecord } = c;
  const pdf = await buildProfilePdf({
    appName: SITE_NAME,
    tagline: SITE_TAGLINE,
    generatedAt: new Date(),
    profileCode: youRecord.profileCode,
    fullName: "Match summary",
    headline: `For ${youRecord.fullName} (${youRecord.profileCode}, ${formatEnumLabel(youRecord.gender)}, ${calculateAge(youRecord.dateOfBirth)} years)  |  compared with ${otherRecord.fullName} (${otherRecord.profileCode})`,
    verified: false,
    sections: comparisonSections({ you: c.you, other: c.other, total: c.total, tierLabel: c.tierLabel, breakdown: c.breakdown }),
    logoPng,
    photo: null,
    footer: `Prepared by ${SITE_NAME} for matchmaking only. A compatibility suggestion, never a guarantee. The photo and contact details are withheld until both families agree. Please do not forward or publish this sheet.`,
  });

  await writeAudit({
    action: "SENSITIVE_DATA_EXPORTED",
    adminId: admin.id,
    targetProfileId: youRecord.id,
    meta: { kind: "MATCH_COMPARISON_PDF", matchId: c.match.id, for: c.match.profileBId === youRecord.id ? "B" : "A", via, sourceId },
  });

  return { pdf, filename: `match-${youRecord.profileCode}-${otherRecord.profileCode}.pdf` };
}
