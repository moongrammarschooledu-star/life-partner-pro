import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { writeAudit } from "@/lib/audit";
import { recomputeStoredCompleteness } from "@/lib/verification/status";

// STEP 21 Decision 2 — LifestyleInfo is self-service, immediate (no admin
// review): soft, non-verifiable preference/bio fields, unlike identity or
// eligibility-bearing data.
const STRING_FIELDS = ["religion", "sect", "religiousPractice", "languages", "hobbies", "personality", "aboutMe", "otherPreferences"] as const;
const BOOLEAN_FIELDS = ["smoking", "drinking"] as const;

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const lifestyle = await prisma.lifestyleInfo.findUnique({ where: { profileId } });
  return NextResponse.json({ lifestyle });
}

export async function PATCH(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (await hasActiveRestriction(profileId, "CANNOT_UPDATE_FIELDS")) {
    return NextResponse.json({ error: "Your account currently can't update fields. Contact support for details." }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field] === null ? null : String(body[field]);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] !== undefined) data[field] = !!body[field];
  }

  const lifestyle = await prisma.lifestyleInfo.upsert({
    where: { profileId },
    update: data,
    create: { profileId, ...data },
  });

  await writeAudit({ action: "LIFESTYLE_UPDATED", targetProfileId: profileId, meta: { fields: Object.keys(data) } });
  await recomputeStoredCompleteness(profileId);

  return NextResponse.json({ lifestyle });
}
