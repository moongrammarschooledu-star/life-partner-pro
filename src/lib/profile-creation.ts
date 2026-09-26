import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { nextProfileCode } from "@/lib/profile-code";
import { parseDateOnly } from "@/lib/utils";
import { computeProfileCompleteness } from "@/lib/verification/completeness";
import { CHECKLIST_KEYS } from "@/lib/verification/checklist-catalog";
import { writeAudit } from "@/lib/audit";
import { notifyProfileRegistered, notifyProfileSubmitted } from "@/lib/notifications/events";
import type { RegistrationInput } from "@/lib/validation/registration";

export class ProfileCreationError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface PhotoUploadData {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  ivBase64: string;
  authTagBase64: string;
}

// Extracted from /api/register — shared by the public self-registration
// route and the admin-initiated "Add New Profile" route (POST
// /api/admin/profiles). Same duplicate check, profile-code assignment,
// sub-table creation and initial VERIFICATION_PENDING state either way;
// only who's attributed as the actor (adminId, unset for self-registration —
// see writeAudit's own "admin acted vs owner acted on themselves"
// convention) and what happens after (session cookie vs. redirect) differ,
// and those stay with each route's own handler.
export async function createProfileFromRegistration(
  value: RegistrationInput,
  photoData: PhotoUploadData | null,
  opts: { adminId?: string; ipHashSource: string }
) {
  // Duplicate check (spec §31) — never reveal anything about the matched
  // profile, only that one might already exist.
  const existingContact = await prisma.contactInfo.findFirst({
    where: {
      OR: [{ mobileNumber: value.contact.mobileNumber }, { email: { equals: value.contact.email, mode: "insensitive" } }],
    },
    include: { profile: { select: { status: true, softDeleted: true } } },
  });
  if (
    existingContact &&
    !existingContact.profile.softDeleted &&
    existingContact.profile.status !== "REJECTED" &&
    existingContact.profile.status !== "ARCHIVED"
  ) {
    throw new ProfileCreationError(
      409,
      "We found a possible existing profile. Please contact Life Partner Pro support if you already have an account."
    );
  }

  const profileCode = await nextProfileCode();
  // Canonical post-registration score (STEP 8 §10) — distinct from the
  // wizard's own live per-step preview, see profile-completion.ts.
  const { percent: profileCompletion } = computeProfileCompleteness({
    fullName: value.basic.fullName,
    gender: value.basic.gender,
    dateOfBirth: value.basic.dateOfBirth,
    maritalStatus: value.basic.maritalStatus,
    heightCm: value.basic.heightCm,
    city: value.basic.city,
    country: value.basic.country,
    nationality: value.basic.nationality,
    area: value.basic.area,
    contact: { mobileNumber: value.contact.mobileNumber, email: value.contact.email, whatsappNumber: value.contact.whatsappNumber },
    phoneVerified: false,
    emailVerified: false,
    education: { level: value.educationProfession.educationLevel, degree: value.educationProfession.degree, institution: value.educationProfession.institution },
    profession: {
      profession: value.educationProfession.profession,
      employmentType: value.educationProfession.employmentType,
      monthlyIncome: value.educationProfession.monthlyIncome,
      jobTitle: value.educationProfession.jobTitle,
      businessDetails: value.educationProfession.businessDetails,
    },
    family: {
      fatherOccupation: value.family.fatherOccupation,
      motherOccupation: value.family.motherOccupation,
      familyType: value.family.familyType,
      familyLocation: value.family.familyLocation,
      familyBackground: value.family.familyBackground,
    },
    lifestyle: {
      religion: value.lifestyle.religion,
      languages: value.lifestyle.languages,
      hobbies: value.lifestyle.hobbies,
      aboutMe: value.lifestyle.aboutMe,
    },
    preference: {
      minAge: value.preference.minAge,
      maxAge: value.preference.maxAge,
      preferredCity: value.preference.preferredCity,
      preferredCountry: value.preference.preferredCountry,
      minEducation: value.preference.minEducation,
      maritalStatusPreference: value.preference.maritalStatusPreference,
      minHeightCm: value.preference.minHeightCm,
      maxHeightCm: value.preference.maxHeightCm,
    },
    hasPhoto: !!photoData,
  });

  const showsChildren = ["DIVORCED", "WIDOWED", "SEPARATED"].includes(value.basic.maritalStatus);

  const profile = await prisma.profile.create({
    data: {
      profileCode,
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
      profileCompletion,
      contact: {
        create: {
          mobileNumber: value.contact.mobileNumber,
          whatsappNumber: value.contact.whatsappNumber || null,
          email: value.contact.email,
          preferredContactMethod: value.contact.preferredContactMethod,
        },
      },
      education: {
        create: {
          level: value.educationProfession.educationLevel,
          degree: value.educationProfession.degree || null,
          institution: value.educationProfession.institution || null,
        },
      },
      profession: {
        create: {
          profession: value.educationProfession.profession,
          jobTitle: value.educationProfession.jobTitle || null,
          companyName: value.educationProfession.companyName || null,
          employmentType: value.educationProfession.employmentType,
          monthlyIncome: value.educationProfession.monthlyIncome ?? null,
          annualIncome: value.educationProfession.annualIncome ?? null,
          workLocation: value.educationProfession.workLocation || null,
          businessDetails: value.educationProfession.businessDetails || null,
          program: value.educationProfession.program || null,
          expectedGraduation: value.educationProfession.expectedGraduation || null,
        },
      },
      family: {
        create: {
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
      },
      lifestyle: {
        create: {
          religion: value.lifestyle.religion || null,
          sect: value.lifestyle.sect || null,
          religiousPractice: value.lifestyle.religiousPractice || null,
          languages: value.lifestyle.languages || null,
          smoking: value.lifestyle.smoking,
          drinking: value.lifestyle.drinking,
          hobbies: value.lifestyle.hobbies || null,
          personality: value.lifestyle.personality || null,
          aboutMe: value.lifestyle.aboutMe || null,
          otherPreferences: value.lifestyle.otherPreferences || null,
        },
      },
      preference: {
        create: {
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
      },
      // Four distinct checkboxes, mapped to the four ConsentRecord fields.
      // "accurate" (accuracy attestation) doubles as terms acceptance since
      // the wizard displays the Terms/Privacy links right alongside it;
      // "contactConsent" is the spec's one genuinely optional checkbox.
      consent: {
        create: {
          privacyConsent: value.consent.reviewConsent,
          matchmakingConsent: value.consent.storageConsent,
          contactSharingConsent: value.consent.contactConsent,
          termsAccepted: value.consent.accurate,
          consentVersion: "1.0",
          ipHash: createHash("sha256").update(opts.ipHashSource).digest("hex"),
        },
      },
      ...(photoData
        ? {
            photos: {
              create: {
                storageKey: photoData.storageKey,
                mimeType: photoData.mimeType,
                sizeBytes: photoData.sizeBytes,
                ivBase64: photoData.ivBase64,
                authTagBase64: photoData.authTagBase64,
                isPrimary: true,
              },
            },
          }
        : {}),
    },
  });

  // A freshly-submitted profile is immediately awaiting an admin's
  // verification action — VERIFICATION_PENDING, not the "hasn't started
  // anything yet" NOT_VERIFIED state (STEP 8 §2).
  await prisma.profileVerification.create({
    data: {
      profileId: profile.id,
      status: "VERIFICATION_PENDING",
      items: { create: CHECKLIST_KEYS.map((itemKey) => ({ itemKey })) },
    },
  });

  await writeAudit({ action: "PROFILE_CREATED", adminId: opts.adminId, targetProfileId: profile.id, meta: { profileCode } });
  await notifyProfileRegistered(profile.id);
  await notifyProfileSubmitted(profile.id);

  return { profile, profileCode };
}
