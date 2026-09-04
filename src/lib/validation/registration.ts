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
    gender: z.enum(["MALE", "FEMALE"]),
    dateOfBirth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date"),
    maritalStatus: z.enum(["NEVER_MARRIED", "DIVORCED", "WIDOWED", "ANNULLED", "SEPARATED", "OTHER"]),
    hasChildren: z.boolean().nullable().optional(),
    numberOfChildren: optionalNumber(0, 20),
    heightCm: z.coerce.number().int().min(100).max(230),
    city: z.string().trim().min(1, "Please select your city.").max(80),
    area: z.string().trim().max(80).optional().or(z.literal("")),
    country: z.string().trim().min(1, "Country is required").max(80),
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
  email: z.string().trim().email("Please enter a valid email address."),
  preferredContactMethod: z.enum(["PHONE", "WHATSAPP", "EMAIL"]),
});

export const educationProfessionSchema = z.object({
  educationLevel: z.string().trim().min(1, "Education level is required").max(60),
  degree: z.string().trim().max(120).optional().or(z.literal("")),
  institution: z.string().trim().max(150).optional().or(z.literal("")),
  profession: z.string().trim().min(1, "Profession is required").max(120),
  jobTitle: z.string().trim().max(120).optional().or(z.literal("")),
  companyName: z.string().trim().max(150).optional().or(z.literal("")),
  employmentType: z.enum(["GOVERNMENT", "PRIVATE", "BUSINESS_OWNER", "SELF_EMPLOYED", "FREELANCE", "NOT_WORKING", "STUDENT"]),
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
  familyType: z.enum(["NUCLEAR", "JOINT", "EXTENDED"]),
  familyStatus: z.enum(["MIDDLE_CLASS", "UPPER_MIDDLE_CLASS", "UPPER_CLASS", "WELL_SETTLED"]),
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
  lifestyle: lifestyleSchema,
  preference: partnerPreferenceSchema,
  consent: consentSchema,
});

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type BasicInfoInput = z.infer<typeof basicInfoSchema>;
export type ContactInfoInput = z.infer<typeof contactInfoSchema>;
export type EducationProfessionInput = z.infer<typeof educationProfessionSchema>;
export type FamilyInfoInput = z.infer<typeof familyInfoSchema>;
export type LifestyleInput = z.infer<typeof lifestyleSchema>;
export type PartnerPreferenceInput = z.infer<typeof partnerPreferenceSchema>;
