import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { generateReferralCode } from "@/lib/referrals/referral-service";
import { getReferralOverview } from "@/lib/engagement/referral-extension";

// STEP 27 §42/§43 — only aggregate counts, never the referred person's
// identity or any private field of theirs.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // STEP 30 - same aggregate counts as before, plus a share link, a history with neutral status wording and a masked referee
  // label ("Referred member 1"). Nothing about the person who used the code is ever returned.
  return NextResponse.json(await getReferralOverview(profileId));
}

export async function POST() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const program = await prisma.referralProgram.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  if (!program) return NextResponse.json({ error: "No active referral program is currently available." }, { status: 404 });

  const existing = await prisma.referralCode.findFirst({ where: { profileId, programId: program.id } });
  if (existing) return NextResponse.json({ code: existing.code });

  const code = await generateReferralCode(profileId, program.id);
  return NextResponse.json({ code });
}
