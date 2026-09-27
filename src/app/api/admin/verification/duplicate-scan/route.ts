import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { findDuplicateSignals, computeDuplicateConfidence, type DuplicateCandidateProfile } from "@/lib/verification/duplicate-detection";
import { notifyDuplicateScanSummary } from "@/lib/notifications/events";
import { nextSequenceCode } from "@/lib/privacy/codes";

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
        const [profileAId, profileBId] = [profile.id, match.candidateId].sort();
        const pairKey = `${profileAId}:${profileBId}`;
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

        // STEP 23 — an already-reviewed pair (confirmed OR explicitly
        // dismissed as unrelated) is never re-flagged (plan decision 8).
        const existingRelationship = await prisma.accountRelationship.findFirst({
          where: {
            status: "ACTIVE",
            relationshipType: { in: ["CONFIRMED_DUPLICATE", "UNKNOWN_RELATIONSHIP"] },
            OR: [
              { profileId: profileAId, relatedProfileId: profileBId },
              { profileId: profileBId, relatedProfileId: profileAId },
            ],
          },
        });
        if (existingRelationship) continue;

        const flag = await prisma.securityFlag.create({
          data: {
            profileId: profile.id,
            relatedProfileId: match.candidateId,
            flagType: "DUPLICATE_PROFILE_SUSPECTED",
            severity: match.signals.includes("MOBILE") || match.signals.includes("EMAIL") ? "HIGH" : "MEDIUM",
            description: `Possible duplicate detected via: ${match.signals.join(", ")}.`,
          },
        });

        // STEP 23 — the richer evidence companion (plan decision 3), always
        // recorded with a consistent (sorted) profile ordering so a pair
        // scanned from either direction never creates two candidate rows.
        const confidence = computeDuplicateConfidence(match.signals);
        await prisma.duplicateCandidate.create({
          data: {
            candidateCode: await nextSequenceCode("DUPC"),
            profileId: profileAId,
            candidateProfileId: profileBId,
            securityFlagId: flag.id,
            confidenceBand: confidence.band,
            confidenceScore: confidence.score,
            matchingSignals: JSON.stringify(match.signals),
          },
        });
        flagsCreated++;
      }
    }

    await writeAudit({ action: "DUPLICATE_SCAN_RUN", adminId: admin.id, meta: { profilesScanned: candidates.length, flagsCreated } });
    await notifyDuplicateScanSummary(flagsCreated);

    return NextResponse.json({ profilesScanned: candidates.length, flagsCreated });
  } catch (error) {
    return handleApiError(error);
  }
}
