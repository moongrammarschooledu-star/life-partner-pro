import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import { registrationSchema } from "@/lib/validation/registration";
import { prisma } from "@/lib/prisma";
import { nextProfileCode } from "@/lib/profile-code";
import { savePhoto, UploadValidationError } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { parseDateOnly } from "@/lib/utils";
import { computeCompletion } from "@/lib/profile-completion";
import { signProfileToken, APPLICANT_COOKIE } from "@/lib/applicant-session";

const CONSENT_VERSION = "1.0";
const GENERIC_ERROR = "Your profile could not be submitted. Please check the highlighted fields.";

export async function POST(req: Request) {
  const key = `register:${clientKeyFromRequest(req)}`;
  if (!rateLimit(key, 5, 60_000)) {
    return NextResponse.json({ error: "Too many submissions. Please try again in a minute." }, { status: 429 });
  }

  try {
    const formData = await req.formData();
    const rawPayload = formData.get("payload");
    if (typeof rawPayload !== "string") {
      return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
    }

    const parsed = JSON.parse(rawPayload);

    // Honeypot: a real user never sees or fills this field (visually hidden
    // in the wizard). A non-empty value is treated identically to any other
    // validation failure — no signal is given back to distinguish a bot.
    if (typeof parsed.hp === "string" && parsed.hp.length > 0) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
    }

    const result = registrationSchema.safeParse(parsed);
    if (!result.success) {
      return NextResponse.json({ error: GENERIC_ERROR, issues: result.error.issues }, { status: 400 });
    }
    const value = result.data;

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
      return NextResponse.json(
        { error: "We found a possible existing profile. Please contact Life Partner Pro support if you already have an account." },
        { status: 409 }
      );
    }

    let photoData: { storageKey: string; mimeType: string; sizeBytes: number } | null = null;
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      const buffer = Buffer.from(await photo.arrayBuffer());
      try {
        photoData = await savePhoto(buffer, photo.type);
      } catch (err) {
        if (err instanceof UploadValidationError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    }

    const profileCode = await nextProfileCode();
    const { percent: profileCompletion } = computeCompletion({
      hasPhoto: !!photoData,
      area: value.basic.area,
      nationality: value.basic.nationality,
      degree: value.educationProfession.degree,
      institution: value.educationProfession.institution,
      familyBackground: value.family.familyBackground,
      aboutMe: value.lifestyle.aboutMe,
      hobbies: value.lifestyle.hobbies,
      personality: value.lifestyle.personality,
      religion: value.lifestyle.religion,
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
            consentVersion: CONSENT_VERSION,
            ipHash: createHash("sha256").update(clientKeyFromRequest(req)).digest("hex"),
          },
        },
        ...(photoData
          ? {
              photos: {
                create: {
                  storageKey: photoData.storageKey,
                  mimeType: photoData.mimeType,
                  sizeBytes: photoData.sizeBytes,
                  isPrimary: true,
                },
              },
            }
          : {}),
      },
    });

    await writeAudit({ action: "PROFILE_CREATED", targetProfileId: profile.id, meta: { profileCode } });

    // Powers the private /my-status page for this browser — no accounts,
    // no URL/ID exposure, just a signed cookie scoped to this one profile.
    const cookieStore = await cookies();
    cookieStore.set(APPLICANT_COOKIE, signProfileToken(profile.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return NextResponse.json({ profileCode });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
