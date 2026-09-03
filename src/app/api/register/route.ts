import { NextResponse } from "next/server";
import { registrationSchema } from "@/lib/validation/registration";
import { prisma } from "@/lib/prisma";
import { nextProfileCode } from "@/lib/profile-code";
import { savePhoto, UploadValidationError } from "@/lib/storage";
import { writeAudit } from "@/lib/audit";
import { rateLimit, clientKeyFromRequest } from "@/lib/rate-limit";
import { parseDateOnly } from "@/lib/utils";

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
    const result = registrationSchema.safeParse(parsed);
    if (!result.success) {
      return NextResponse.json(
        { error: "Your profile could not be submitted. Please check the highlighted fields.", issues: result.error.issues },
        { status: 400 }
      );
    }
    const value = result.data;

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

    const profile = await prisma.profile.create({
      data: {
        profileCode,
        fullName: value.basic.fullName,
        gender: value.basic.gender,
        dateOfBirth: parseDateOnly(value.basic.dateOfBirth),
        maritalStatus: value.basic.maritalStatus,
        heightCm: value.basic.heightCm,
        city: value.basic.city,
        area: value.basic.area || null,
        country: value.basic.country,
        nationality: value.basic.nationality || null,
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
            otherPreferences: value.lifestyle.otherPreferences || null,
          },
        },
        preference: {
          create: {
            minAge: value.preference.minAge ?? null,
            maxAge: value.preference.maxAge ?? null,
            preferredCountry: value.preference.preferredCountry || null,
            preferredCity: value.preference.preferredCity || null,
            preferredArea: value.preference.preferredArea || null,
            minEducation: value.preference.minEducation || null,
            preferredEducation: value.preference.preferredEducation || null,
            professionPreference: value.preference.professionPreference || null,
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
        consent: {
          create: {},
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

    return NextResponse.json({ profileCode });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
