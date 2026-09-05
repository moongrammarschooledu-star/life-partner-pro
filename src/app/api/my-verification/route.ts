import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";
import { CHECKLIST_CATALOG } from "@/lib/verification/checklist-catalog";
import { computeProfileCompleteness } from "@/lib/verification/completeness";

// Deliberately narrow (spec §20): mobile/email/profile status, completeness
// %, and the requirement checklist as plain ✓/⏳/⚠ — never internal
// verification-confidence scores, admin notes, or investigation details.
export async function GET() {
  const cookieStore = await cookies();
  const profileId = verifyProfileToken(cookieStore.get(APPLICANT_COOKIE)?.value);
  if (!profileId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: {
      contact: true,
      education: true,
      profession: true,
      family: true,
      lifestyle: true,
      preference: true,
      photos: { select: { id: true } },
      verification: { include: { items: true } },
    },
  });
  if (!profile || profile.softDeleted) return NextResponse.json({ error: "Not found." }, { status: 401 });

  const verification = profile.verification;
  const phoneVerified = !!verification?.phoneVerifiedAt;
  const emailVerified = !!verification?.emailVerifiedAt;

  const { percent, categories } = computeProfileCompleteness({
    fullName: profile.fullName,
    gender: profile.gender,
    dateOfBirth: profile.dateOfBirth,
    maritalStatus: profile.maritalStatus,
    heightCm: profile.heightCm,
    city: profile.city,
    country: profile.country,
    nationality: profile.nationality,
    area: profile.area,
    contact: profile.contact,
    phoneVerified,
    emailVerified,
    education: profile.education,
    profession: profile.profession,
    family: profile.family,
    lifestyle: profile.lifestyle,
    preference: profile.preference,
    hasPhoto: profile.photos.length > 0,
  });

  const itemByKey = new Map(verification?.items.map((i) => [i.itemKey, i]) ?? []);
  const requestedInfoItems: string[] = verification?.requestedInfoItems ? JSON.parse(verification.requestedInfoItems) : [];

  const checklist = CHECKLIST_CATALOG.map((entry) => {
    const item = itemByKey.get(entry.key);
    const requiresAttention = requestedInfoItems.includes(entry.key);
    let state: "completed" | "under_review" | "action_required" | "pending";
    if (requiresAttention) state = "action_required";
    else if (item?.status === "COMPLETED") state = "completed";
    else if (verification?.status === "UNDER_REVIEW") state = "under_review";
    else state = "pending";
    return { key: entry.key, category: entry.category, label: entry.label, state };
  });

  return NextResponse.json({
    profileCode: profile.profileCode,
    status: verification?.status ?? "NOT_VERIFIED",
    phoneVerified,
    emailVerified,
    completeness: { percent, categories: categories.map((c) => ({ key: c.key, label: c.label, weight: c.weight, earnedWeight: c.earnedWeight, missingFields: c.missingFields })) },
    checklist,
  });
}
