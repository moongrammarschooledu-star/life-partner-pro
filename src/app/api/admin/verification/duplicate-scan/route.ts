import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { findDuplicateSignals, type DuplicateCandidateProfile } from "@/lib/verification/duplicate-detection";

// Admin-triggered scan (spec §12) — never a background cron, matching the
// project's existing match-caching deferral precedent. Never auto-deletes;
// only creates/reuses a SecurityFlag(DUPLICATE_PROFILE_SUSPECTED) per pair
// for admin review.
export async function POST() {
  try {
    const admin = await requireAdmin("verification:duplicate:scan");

    const profiles = await prisma.profile.findMany({
      where: { softDeleted: false },
      include: { contact: true },
    });

    const candidates: DuplicateCandidateProfile[] = profiles
      .filter((p) => p.contact)
      .map((p) => ({ id: p.id, fullName: p.fullName, dateOfBirth: p.dateOfBirth.toISOString(), mobileNumber: p.contact!.mobileNumber, email: p.contact!.email }));

    const seenPairs = new Set<string>();
    let flagsCreated = 0;

    for (const profile of candidates) {
      const matches = findDuplicateSignals(profile, candidates);
      for (const match of matches) {
        const pairKey = [profile.id, match.candidateId].sort().join(":");
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        const existing = await prisma.securityFlag.findFirst({
          where: {
            flagType: "DUPLICATE_PROFILE_SUSPECTED",
            status: { in: ["OPEN", "INVESTIGATING"] },
            OR: [
              { profileId: profile.id, relatedProfileId: match.candidateId },
              { profileId: match.candidateId, relatedProfileId: profile.id },
            ],
          },
        });
        if (existing) continue;

        await prisma.securityFlag.create({
          data: {
            profileId: profile.id,
            relatedProfileId: match.candidateId,
            flagType: "DUPLICATE_PROFILE_SUSPECTED",
            severity: match.signals.includes("MOBILE") || match.signals.includes("EMAIL") ? "HIGH" : "MEDIUM",
            description: `Possible duplicate detected via: ${match.signals.join(", ")}.`,
          },
        });
        flagsCreated++;
      }
    }

    await writeAudit({ action: "DUPLICATE_SCAN_RUN", adminId: admin.id, meta: { profilesScanned: candidates.length, flagsCreated } });

    return NextResponse.json({ profilesScanned: candidates.length, flagsCreated });
  } catch (error) {
    return handleApiError(error);
  }
}
