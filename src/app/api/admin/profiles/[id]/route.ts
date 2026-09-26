import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { profileDetailInclude, toDetailDto } from "@/lib/serializers";
import { writeAudit } from "@/lib/audit";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { parseDateOnly } from "@/lib/utils";
import { basicInfoSchema, educationProfessionSchema, familyInfoSchema, lifestyleSchema, partnerPreferenceSchema } from "@/lib/validation/registration";

// Every section is independently optional — a PATCH only ever touches the
// sections the admin edit form actually submitted, never wipes sections it
// didn't. This matters beyond ordinary partial-update hygiene: `family` and
// two fields inside `educationProfession`/`lifestyle` are hidden from the
// admin entirely (see toDetailDto's sensitive:family:view / sensitive:income:view
// gating) when they lack the permission to view them, and the edit form
// omits those keys/fields for such an admin — the raw-body presence checks
// below (not zod, which can't distinguish "key omitted" from "key sent
// empty" once optional fields normalize to undefined) are what stop an
// admin who can edit a profile but can't SEE its family/income data from
// silently blanking it out.
const adminProfileEditSchema = z.object({
  basic: basicInfoSchema.optional(),
  educationProfession: educationProfessionSchema.optional(),
  family: familyInfoSchema.optional(),
  lifestyle: lifestyleSchema.optional(),
  preference: partnerPreferenceSchema.optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:view", { allowViewAs: true });
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);

    const profile = await prisma.profile.findUnique({ where: { id }, include: profileDetailInclude });
    if (!profile) throw new ApiError(404, "Profile not found");

    await writeAudit({ action: "PROFILE_VIEWED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json(toDetailDto(profile, admin.id, admin.permissions));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:edit");
    const { id } = await params;
    await assertProfileAssignmentAccess(admin, id);
    const body = await req.json();

    const existing = await prisma.profile.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Profile not found");

    const result = adminProfileEditSchema.safeParse(body);
    if (!result.success) {
      throw new ApiError(400, result.error.issues[0]?.message ?? "Please check the highlighted fields.");
    }
    const value = result.data;

    const rawEducationProfession = (body.educationProfession ?? {}) as Record<string, unknown>;
    const touchesMonthlyIncome = "monthlyIncome" in rawEducationProfession;
    const touchesAnnualIncome = "annualIncome" in rawEducationProfession;

    const rawLifestyle = (body.lifestyle ?? {}) as Record<string, unknown>;
    const touchesReligion = "religion" in rawLifestyle;
    const touchesSect = "sect" in rawLifestyle;
    const touchesReligiousPractice = "religiousPractice" in rawLifestyle;

    const showsChildren = value.basic ? ["DIVORCED", "WIDOWED", "SEPARATED"].includes(value.basic.maritalStatus) : undefined;

    const profile = await prisma.profile.update({
      where: { id },
      data: {
        ...(value.basic
          ? {
              fullName: value.basic.fullName,
              gender: value.basic.gender,
              dateOfBirth: parseDateOnly(value.basic.dateOfBirth),
              maritalStatus: value.basic.maritalStatus,
              hasChildren: showsChildren ? (value.basic.hasChildren ?? null) : null,
              numberOfChildren: showsChildren ? (value.basic.numberOfChildren ?? null) : null,
              heightCm: value.basic.heightCm,
              city: value.basic.city,
              area: value.basic.area || null,
              country: value.basic.country,
              nationality: value.basic.nationality || null,
            }
          : {}),
        education: value.educationProfession
          ? {
              update: {
                level: value.educationProfession.educationLevel,
                degree: value.educationProfession.degree || null,
                institution: value.educationProfession.institution || null,
              },
            }
          : undefined,
        // monthlyIncome/annualIncome are only ever included in the update
        // when the raw request actually carried that key — see the note
        // above adminProfileEditSchema. `undefined` in a Prisma `update`
        // data object means "leave this field alone", not "set it to null".
        profession: value.educationProfession
          ? {
              update: {
                profession: value.educationProfession.profession,
                jobTitle: value.educationProfession.jobTitle || null,
                companyName: value.educationProfession.companyName || null,
                employmentType: value.educationProfession.employmentType,
                monthlyIncome: touchesMonthlyIncome ? (value.educationProfession.monthlyIncome ?? null) : undefined,
                annualIncome: touchesAnnualIncome ? (value.educationProfession.annualIncome ?? null) : undefined,
                workLocation: value.educationProfession.workLocation || null,
                businessDetails: value.educationProfession.businessDetails || null,
                program: value.educationProfession.program || null,
                expectedGraduation: value.educationProfession.expectedGraduation || null,
              },
            }
          : undefined,
        // Omitted entirely (not sent at all) by the edit form when the admin
        // lacks sensitive:family:view — never partially touched.
        family: value.family
          ? {
              update: {
                fatherOccupation: value.family.fatherOccupation || null,
                motherOccupation: value.family.motherOccupation || null,
                numberOfBrothers: value.family.numberOfBrothers,
                numberOfSisters: value.family.numberOfSisters,
                familyType: value.family.familyType,
                familyStatus: value.family.familyStatus,
                familyLocation: value.family.familyLocation || null,
                familyBackground: value.family.familyBackground || null,
                additionalInfo: value.family.additionalInfo || null,
              },
            }
          : undefined,
        lifestyle: value.lifestyle
          ? {
              update: {
                // religion/sect/religiousPractice are also gated behind
                // sensitive:family:view (see toDetailDto) — same
                // touches-key guard as income above.
                religion: touchesReligion ? (value.lifestyle.religion || null) : undefined,
                sect: touchesSect ? (value.lifestyle.sect || null) : undefined,
                religiousPractice: touchesReligiousPractice ? (value.lifestyle.religiousPractice || null) : undefined,
                languages: value.lifestyle.languages || null,
                smoking: value.lifestyle.smoking,
                drinking: value.lifestyle.drinking,
                hobbies: value.lifestyle.hobbies || null,
                personality: value.lifestyle.personality || null,
                aboutMe: value.lifestyle.aboutMe || null,
                otherPreferences: value.lifestyle.otherPreferences || null,
              },
            }
          : undefined,
        preference: value.preference
          ? {
              update: {
                minAge: value.preference.minAge ?? null,
                maxAge: value.preference.maxAge ?? null,
                agePriority: value.preference.agePriority,
                preferredCountry: value.preference.preferredCountry || null,
                preferredCity: value.preference.preferredCity || null,
                preferredArea: value.preference.preferredArea || null,
                locationScope: value.preference.locationScope || null,
                locationPriority: value.preference.locationPriority,
                minEducation: value.preference.minEducation || null,
                preferredEducation: value.preference.preferredEducation || null,
                professionPreference: value.preference.professionPreference || null,
                professionPriority: value.preference.professionPriority,
                minIncome: value.preference.minIncome ?? null,
                maxIncome: value.preference.maxIncome ?? null,
                incomeFlexible: value.preference.incomeFlexible,
                maritalStatusPreference: value.preference.maritalStatusPreference || null,
                minHeightCm: value.preference.minHeightCm ?? null,
                maxHeightCm: value.preference.maxHeightCm ?? null,
                familyTypePreference: value.preference.familyTypePreference || null,
                familyBackgroundPreference: value.preference.familyBackgroundPreference || null,
                otherFamilyRequirements: value.preference.otherFamilyRequirements || null,
                additionalExpectations: value.preference.additionalExpectations || null,
              },
            }
          : undefined,
      },
      include: profileDetailInclude,
    });

    await writeAudit({ action: "PROFILE_EDITED", adminId: admin.id, targetProfileId: id, meta: { sections: Object.keys(value) } });

    return NextResponse.json(toDetailDto(profile, admin.id, admin.permissions));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("profile:delete");
    const { id } = await params;

    await prisma.profile.update({ where: { id }, data: { softDeleted: true, status: "ARCHIVED" } });
    await writeAudit({ action: "PROFILE_DELETED", adminId: admin.id, targetProfileId: id });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
