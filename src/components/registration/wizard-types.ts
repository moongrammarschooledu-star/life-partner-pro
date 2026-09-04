export interface WizardData {
  // Honeypot — real users never see or fill this (visually hidden in the
  // wizard shell); a filled value means the submission is very likely a bot.
  hp: string;
  basic: {
    fullName: string;
    gender: "MALE" | "FEMALE" | "";
    dateOfBirth: string;
    maritalStatus: "NEVER_MARRIED" | "DIVORCED" | "WIDOWED" | "ANNULLED" | "SEPARATED" | "OTHER" | "";
    hasChildren: boolean | null;
    numberOfChildren: string;
    heightCm: string;
    city: string;
    area: string;
    country: string;
    nationality: string;
  };
  contact: {
    mobileNumber: string;
    whatsappNumber: string;
    email: string;
    preferredContactMethod: "PHONE" | "WHATSAPP" | "EMAIL";
  };
  educationProfession: {
    educationLevel: string;
    degree: string;
    institution: string;
    profession: string;
    jobTitle: string;
    companyName: string;
    employmentType: "GOVERNMENT" | "PRIVATE" | "BUSINESS_OWNER" | "SELF_EMPLOYED" | "FREELANCE" | "NOT_WORKING" | "STUDENT";
    monthlyIncome: string;
    annualIncome: string;
    workLocation: string;
    businessDetails: string;
    program: string;
    expectedGraduation: string;
  };
  family: {
    fatherOccupation: string;
    motherOccupation: string;
    numberOfBrothers: string;
    numberOfSisters: string;
    familyType: "NUCLEAR" | "JOINT" | "EXTENDED";
    familyStatus: "MIDDLE_CLASS" | "UPPER_MIDDLE_CLASS" | "UPPER_CLASS" | "WELL_SETTLED";
    familyLocation: string;
    familyBackground: string;
    additionalInfo: string;
  };
  lifestyle: {
    religion: string;
    sect: string;
    religiousPractice: string;
    languages: string;
    smoking: boolean;
    drinking: boolean;
    hobbies: string;
    personality: string;
    aboutMe: string;
    otherPreferences: string;
  };
  preference: {
    minAge: string;
    maxAge: string;
    agePriority: "MUST_HAVE" | "PREFERRED" | "FLEXIBLE";
    preferredCountry: string;
    preferredCity: string;
    preferredArea: string;
    locationScope: string;
    locationPriority: "MUST_HAVE" | "PREFERRED" | "FLEXIBLE";
    minEducation: string;
    preferredEducation: string;
    professionPreference: string;
    professionPriority: "MUST_HAVE" | "PREFERRED" | "FLEXIBLE";
    minIncome: string;
    maxIncome: string;
    incomeFlexible: boolean;
    maritalStatusPreference: string;
    minHeightCm: string;
    maxHeightCm: string;
    familyTypePreference: string;
    familyBackgroundPreference: string;
    otherFamilyRequirements: string;
    additionalExpectations: string;
  };
  consent: {
    accurate: boolean;
    storageConsent: boolean;
    reviewConsent: boolean;
    contactConsent: boolean;
  };
}

export const initialWizardData: WizardData = {
  hp: "",
  basic: {
    fullName: "",
    gender: "",
    dateOfBirth: "",
    maritalStatus: "",
    hasChildren: null,
    numberOfChildren: "",
    heightCm: "",
    city: "",
    area: "",
    country: "",
    nationality: "",
  },
  contact: { mobileNumber: "", whatsappNumber: "", email: "", preferredContactMethod: "WHATSAPP" },
  educationProfession: {
    educationLevel: "",
    degree: "",
    institution: "",
    profession: "",
    jobTitle: "",
    companyName: "",
    employmentType: "PRIVATE",
    monthlyIncome: "",
    annualIncome: "",
    workLocation: "",
    businessDetails: "",
    program: "",
    expectedGraduation: "",
  },
  family: {
    fatherOccupation: "",
    motherOccupation: "",
    numberOfBrothers: "0",
    numberOfSisters: "0",
    familyType: "NUCLEAR",
    familyStatus: "MIDDLE_CLASS",
    familyLocation: "",
    familyBackground: "",
    additionalInfo: "",
  },
  lifestyle: {
    religion: "",
    sect: "",
    religiousPractice: "",
    languages: "",
    smoking: false,
    drinking: false,
    hobbies: "",
    personality: "",
    aboutMe: "",
    otherPreferences: "",
  },
  preference: {
    minAge: "",
    maxAge: "",
    agePriority: "PREFERRED",
    preferredCountry: "",
    preferredCity: "",
    preferredArea: "",
    locationScope: "",
    locationPriority: "PREFERRED",
    minEducation: "",
    preferredEducation: "",
    professionPreference: "ANY",
    professionPriority: "PREFERRED",
    minIncome: "",
    maxIncome: "",
    incomeFlexible: true,
    maritalStatusPreference: "ANY",
    minHeightCm: "",
    maxHeightCm: "",
    familyTypePreference: "ANY",
    familyBackgroundPreference: "ANY",
    otherFamilyRequirements: "",
    additionalExpectations: "",
  },
  consent: { accurate: false, storageConsent: false, reviewConsent: false, contactConsent: false },
};

export const STEP_TITLES = [
  "Basic Information",
  "Contact Information",
  "Education & Profession",
  "Family Information",
  "Lifestyle",
  "Partner Requirements",
  "Photo",
  "Review & Submit",
];
