import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApplicantProfileId } from "@/lib/require-applicant";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { writeAudit } from "@/lib/audit";
import { recomputeStoredCompleteness } from "@/lib/verification/status";
import type { PreferencePriority } from "@prisma/client";

const VALID_PRIORITIES: PreferencePriority[] = ["MUST_HAVE", "PREFERRED", "FLEXIBLE"];

// STEP 21 Decision 2 — PartnerPreference is self-service, immediate (no
// admin review): it only narrows which candidates get proposed to this
// applicant, carrying no fraud/eligibility risk the way editing one's own
// identity/education/profession/family would. Still gated by
// hasActiveRestriction for defense in depth, matching every other
// self-service field group.
const NUMERIC_FIELDS = ["minAge", "maxAge", "minIncome", "maxIncome", "minHeightCm", "maxHeightCm"] as const;
const STRING_FIELDS = [
  "preferredCountry",
  "preferredCity",
  "preferredArea",
  "minEducation",
  "preferredEducation",
  "professionPreference",
  "maritalStatusPreference",
  "familyTypePreference",
  "familyBackgroundPreference",
  "otherFamilyRequirements",
  "additionalExpectations",
  "locationScope",
] as const;
const BOOLEAN_FIELDS = ["incomeFlexible"] as const;
const PRIORITY_FIELDS = ["agePriority", "locationPriority", "professionPriority"] as const;

export async function GET() {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const preference = await prisma.partnerPreference.findUnique({ where: { profileId } });
  return NextResponse.json({ preference });
}

export async function PATCH(req: Request) {
  const profileId = await requireApplicantProfileId();
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (await hasActiveRestriction(profileId, "CANNOT_UPDATE_FIELDS")) {
    return NextResponse.json({ error: "Your account currently can't update fields. Contact support for details." }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  for (const field of NUMERIC_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field] === null ? null : Number(body[field]);
  }
  for (const field of STRING_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field] === null ? null : String(body[field]);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (body[field] !== undefined) data[field] = !!body[field];
  }
  for (const field of PRIORITY_FIELDS) {
    if (body[field] !== undefined) {
      if (body[field] !== null && !VALID_PRIORITIES.includes(body[field])) {
        return NextResponse.json({ error: `Invalid value for ${field}.` }, { status: 400 });
      }
      data[field] = body[field];
    }
  }

  const preference = await prisma.partnerPreference.upsert({
    where: { profileId },
    update: data,
    create: { profileId, ...data },
  });

  await writeAudit({ action: "PARTNER_PREFERENCE_UPDATED", targetProfileId: profileId, meta: { fields: Object.keys(data) } });
  await recomputeStoredCompleteness(profileId);

  return NextResponse.json({ preference });
}
