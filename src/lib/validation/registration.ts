import { z } from "zod";

// One schema per registration wizard step (spec §29), plus a merged schema
// used for the final server-side re-validation on submit.

// Wizard state keeps every numeric field as a string (controlled <input>
// values), so an untouched optional field arrives here as "" rather than
// undefined. z.coerce.number() turns "" into 0, which then fails a .min()
// check with no visible error on fields the UI doesn't render one for —
// this normalizes blank/absent values to undefined before coercion so
// "optional" numeric fields are actually optional.
function optionalNumber(min: number, max: number) {
  return z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? undefined : val),
    z.coerce.number().int().min(min).max(max).optional()
  );
}

const priorityEnum = z.enum(["MUST_HAVE", "PREFERRED", "FLEXIBLE"]).default("PREFERRED");

export const basicInfoSchema = z
  .object({
    fullName: z.string().trim().min(2, "Please enter your full name.").max(120),
    gender: z.enum(["MALE", "FEMALE"], "Please select your gender."),
    dateOfBirth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Please choose your day, month and year of birth."),
    maritalStatus: z.enum(["NEVER_MARRIED", "DIVORCED", "WIDOWED", "ANNULLED", "SEPARATED", "OTHER"], "Please select your marital status."),
    hasChildren: z.boolean().nullable().optional(),
    numberOfChildren: optionalNumber(0, 20),
    heightCm: z.coerce.number("Please select your height.").int("Please select your height.").min(100, "Please select your height.").max(230, "Please select your height."),
    city: z.string().trim().min(1, "Please select your city.").max(80),
    area: z.string().trim().max(80).optional().or(z.literal("")),
    country: z.string().trim().min(1, "Please select your country.").max(80),
    nationality: z.string().trim().max(80).optional().or(z.literal("")),
  })
  .refine((v) => !Number.isNaN(new Date(v.dateOfBirth).getTime()) && new Date(v.dateOfBirth) <= new Date(), {
    message: "Date of birth cannot be in the future",
    path: ["dateOfBirth"],
  });

export const contactInfoSchema = z.object({
  mobileNumber: z
    .string()
    .trim()
    .min(7, "Please enter a valid mobile number.")
    .max(20)
    .regex(/^[+0-9][0-9\s-]{6,19}$/, "Please enter a valid mobile number."),
  whatsappNumber: z.string().trim().max(20).optional().or(z.literal("")),
  // Optional in the schema; whether it may be left empty is decided by the phone sign-in switch (the wizard and createProfileFromRegistration both check it).
  email: z.string().trim().email("Please enter a valid email address.").or(z.literal("")).optional(),
  preferredContactMethod: z.enum(["PHONE", "WHATSAPP", "EMAIL"]),
});

export const educationProfessionSchema = z.object({
  educationLevel: z.string().trim().min(1, "Please select your education level.").max(60),
  degree: z.string().trim().max(120).optional().or(z.literal("")),
  institution: z.string().trim().max(150).optional().or(z.literal("")),
  profession: z.string().trim().min(1, "Please enter your profession.").max(120),
  jobTitle: z.string().trim().max(120).optional().or(z.literal("")),
  companyName: z.string().trim().max(150).optional().or(z.literal("")),
  employmentType: z.enum(["GOVERNMENT", "PRIVATE", "BUSINESS_OWNER", "SELF_EMPLOYED", "FREELANCE", "NOT_WORKING", "STUDENT"], "Please select your employment type."),
  monthlyIncome: optionalNumber(0, 10_000_000),
  annualIncome: optionalNumber(0, 100_000_000),
  workLocation: z.string().trim().max(120).optional().or(z.literal("")),
  businessDetails: z.string().trim().max(500).optional().or(z.literal("")),
  program: z.string().trim().max(150).optional().or(z.literal("")),
  expectedGraduation: z.string().trim().max(30).optional().or(z.literal("")),
});

export const familyInfoSchema = z.object({
  fatherOccupation: z.string().trim().max(120).optional().or(z.literal("")),
  motherOccupation: z.string().trim().max(120).optional().or(z.literal("")),
  numberOfBrothers: z.coerce.number().int().min(0).max(30).default(0),
  numberOfSisters: z.coerce.number().int().min(0).max(30).default(0),
  familyType: z.enum(["NUCLEAR", "JOINT", "EXTENDED"], "Please select your family type."),
  familyStatus: z.enum(["MIDDLE_CLASS", "UPPER_MIDDLE_CLASS", "UPPER_CLASS", "WELL_SETTLED"], "Please select your family status."),
  familyLocation: z.string().trim().max(120).optional().or(z.literal("")),
  familyBackground: z.string().trim().max(500).optional().or(z.literal("")),
  additionalInfo: z.string().trim().max(500).optional().or(z.literal("")),
});

export const lifestyleSchema = z.object({
  religion: z.string().trim().max(60).optional().or(z.literal("")),
  sect: z.string().trim().max(60).optional().or(z.literal("")),
  religiousPractice: z.string().trim().max(60).optional().or(z.literal("")),
  languages: z.string().trim().max(200).optional().or(z.literal("")),
  smoking: z.boolean().default(false),
  drinking: z.boolean().default(false),
  hobbies: z.string().trim().max(300).optional().or(z.literal("")),
  personality: z.string().trim().max(300).optional().or(z.literal("")),
  aboutMe: z.string().trim().max(2000).optional().or(z.literal("")),
  otherPreferences: z.string().trim().max(500).optional().or(z.literal("")),
});

export const partnerPreferenceSchema = z.object({
  minAge: optionalNumber(18, 80),
  maxAge: optionalNumber(18, 80),
  agePriority: priorityEnum,
  preferredCountry: z.string().trim().max(80).optional().or(z.literal("")),
  preferredCity: z.string().trim().max(80).optional().or(z.literal("")),
  preferredArea: z.string().trim().max(80).optional().or(z.literal("")),
  locationScope: z.string().trim().max(40).optional().or(z.literal("")),
  locationPriority: priorityEnum,
  minEducation: z.string().trim().max(60).optional().or(z.literal("")),
  preferredEducation: z.string().trim().max(60).optional().or(z.literal("")),
  professionPreference: z.string().trim().max(120).optional().or(z.literal("")),
  professionPriority: priorityEnum,
  minIncome: optionalNumber(0, 100_000_000),
  maxIncome: optionalNumber(0, 100_000_000),
  incomeFlexible: z.boolean().default(true),
  maritalStatusPreference: z.string().trim().max(60).optional().or(z.literal("")),
  minHeightCm: optionalNumber(100, 230),
  maxHeightCm: optionalNumber(100, 230),
  familyTypePreference: z.string().trim().max(30).optional().or(z.literal("")),
  familyBackgroundPreference: z.string().trim().max(30).optional().or(z.literal("")),
  otherFamilyRequirements: z.string().trim().max(500).optional().or(z.literal("")),
  additionalExpectations: z.string().trim().max(2000).optional().or(z.literal("")),
});

// What a NEW registration must give for matching to work (compulsory); the admin edit form keeps using the plain schemas above, so an existing profile can
// still be saved without them. Religion (and, for Islam, the sect) and the partner's age range and country are what the matching scores are built on.
export const registrationLifestyleSchema = lifestyleSchema
  .extend({ religion: z.string().trim().min(1, "Please select your religion.").max(60) })
  .superRefine((v, ctx) => {
    if (/islam|muslim/i.test(v.religion) && !v.sect?.trim()) ctx.addIssue({ code: "custom", path: ["sect"], message: "Please select your sect." });
  });

function requiredAge(message: string) {
  return z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? undefined : val),
    z.coerce.number(message).int(message).min(18, "The age must be 18 or more.").max(80, "The age must be 80 or less.")
  );
}

export const registrationPreferenceSchema = partnerPreferenceSchema
  .extend({
    minAge: requiredAge("Please enter the youngest age you would accept."),
    maxAge: requiredAge("Please enter the oldest age you would accept."),
    preferredCountry: z.string().trim().min(1, "Please select the country you prefer.").max(80),
  })
  .superRefine((v, ctx) => {
    if (typeof v.minAge === "number" && typeof v.maxAge === "number" && v.minAge > v.maxAge) {
      ctx.addIssue({ code: "custom", path: ["maxAge"], message: "The oldest age cannot be lower than the youngest age." });
    }
  });

// Three checkboxes are genuinely required (accuracy, storage, review-disclosure);
// the fourth (contact/communication consent) is explicitly optional per spec
// §15 — a profile can be submitted without it.
export const consentSchema = z.object({
  accurate: z.literal(true, "You must confirm your information is accurate"),
  storageConsent: z.literal(true, "You must agree to secure storage for matchmaking purposes"),
  reviewConsent: z.literal(true, "You must acknowledge admin review"),
  contactConsent: z.boolean().default(false),
});

export const registrationSchema = z.object({
  hp: z.string().max(0).optional().or(z.literal("")),
  basic: basicInfoSchema,
  contact: contactInfoSchema,
  educationProfession: educationProfessionSchema,
  family: familyInfoSchema,
  lifestyle: registrationLifestyleSchema,
  preference: registrationPreferenceSchema,
  consent: consentSchema,
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type BasicInfoInput = z.infer<typeof basicInfoSchema>;
export type ContactInfoInput = z.infer<typeof contactInfoSchema>;
export type EducationProfessionInput = z.infer<typeof educationProfessionSchema>;
export type FamilyInfoInput = z.infer<typeof familyInfoSchema>;
export type LifestyleInput = z.infer<typeof lifestyleSchema>;
export type PartnerPreferenceInput = z.infer<typeof partnerPreferenceSchema>;
