import { NextResponse } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { writeAudit } from "@/lib/audit";
import { buildProfilePdf } from "@/lib/profile-pdf";
import { comparisonSections, type ComparisonRow } from "@/lib/match-comparison-pdf";
import { thresholdsFromSettings, DEFAULT_THRESHOLDS, type MatchThresholds } from "@/lib/matching";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/public-site/config";
import { calculateAge, formatEnumLabel } from "@/lib/utils";

function tierLabelFor(total: number, t: MatchThresholds): string {
  if (total >= t.excellent) return "Excellent Match";
  if (total >= t.veryGood) return "Very Good Match";
  if (total >= t.good) return "Good Match";
  if (total >= t.possible) return "Possible Match";
  return "Low Compatibility";
}

// Downloads the comparison of a match as a sheet for ONE of the two people (?for=A or ?for=B): the two profiles side by side and why they were matched, with no area,
// income, family details, photo or contact details for either side (the names are on it). Only for a pair of verified profiles. Every download is audited.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("match:run");
    const { id } = await params;
    const forB = new URL(req.url).searchParams.get("for") === "B";

    const match = await prisma.match.findUnique({
      where: { id },
      include: { profileA: { include: profileDetailInclude }, profileB: { include: profileDetailInclude } },
    });
    if (!match) throw new ApiError(404, "Match not found");
    await assertProfileAssignmentAccess(admin, match.profileAId);
    await assertProfileAssignmentAccess(admin, match.profileBId);
    for (const p of [match.profileA, match.profileB]) {
      if (p.softDeleted || !p.verified) throw new ApiError(409, "A match comparison can only be downloaded when both profiles are verified.");
    }

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const thresholds = settings ? thresholdsFromSettings(settings) : DEFAULT_THRESHOLDS;
    const breakdown = JSON.parse(match.breakdown) as ComparisonRow[];

    const youRecord = forB ? match.profileB : match.profileA;
    const otherRecord = forB ? match.profileA : match.profileB;
    const sections = comparisonSections({
      you: toDetailDto(youRecord, admin.id, admin.permissions),
      other: toDetailDto(otherRecord, admin.id, admin.permissions),
      total: match.score,
      tierLabel: tierLabelFor(match.score, thresholds),
      breakdown,
    });

    let logoPng: Uint8Array | null = null;
    try {
      const res = await fetch(new URL("/logo-icon.png", req.url));
      if (res.ok) logoPng = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 200 }).png().toBuffer();
    } catch {
      logoPng = null;
    }

    const pdf = await buildProfilePdf({
      appName: SITE_NAME,
      tagline: SITE_TAGLINE,
      generatedAt: new Date(),
      profileCode: youRecord.profileCode,
      fullName: "Match summary",
      headline: `For ${youRecord.fullName} (${youRecord.profileCode}, ${formatEnumLabel(youRecord.gender)}, ${calculateAge(youRecord.dateOfBirth)} years)  |  compared with ${otherRecord.fullName} (${otherRecord.profileCode})`,
      verified: false,
      sections,
      logoPng,
      photo: null,
      footer: `Prepared by ${SITE_NAME} for matchmaking only. A compatibility suggestion, never a guarantee. The photo and contact details are withheld until both families agree. Please do not forward or publish this sheet.`,
    });

    await writeAudit({ action: "SENSITIVE_DATA_EXPORTED", adminId: admin.id, targetProfileId: youRecord.id, meta: { kind: "MATCH_COMPARISON_PDF", matchId: match.id, for: forB ? "B" : "A" } });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="match-${youRecord.profileCode}-${otherRecord.profileCode}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
