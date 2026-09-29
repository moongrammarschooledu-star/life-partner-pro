import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { generateReferralCode, getReferralSummary } from "@/lib/referrals/referral-service";

// STEP 27 §42/§43 — only aggregate counts, never the referred person's
// identity or any private field of theirs.
export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [codes, summary] = await Promise.all([
    prisma.referralCode.findMany({ where: { profileId, active: true }, include: { program: { select: { name: true, status: true } } } }),
    getReferralSummary(profileId),
  ]);
  return NextResponse.json({ codes: codes.map((c) => ({ code: c.code, program: c.program.name, active: c.program.status === "ACTIVE" })), summary });
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
