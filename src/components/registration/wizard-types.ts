export interface WizardData {
  basic: {
    fullName: string;
    gender: "MALE" | "FEMALE" | "";
    dateOfBirth: string;
    maritalStatus: "NEVER_MARRIED" | "DIVORCED" | "WIDOWED" | "ANNULLED" | "";
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
    otherPreferences: string;
  };
  preference: {
    minAge: string;
    maxAge: string;
    preferredCountry: string;
    preferredCity: string;
    preferredArea: string;
    minEducation: string;
    preferredEducation: string;
    professionPreference: string;
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
    agreed: boolean;
  };
}

export const initialWizardData: WizardData = {
  basic: { fullName: "", gender: "", dateOfBirth: "", maritalStatus: "", heightCm: "", city: "", area: "", country: "", nationality: "" },
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
  lifestyle: { religion: "", sect: "", religiousPractice: "", languages: "", smoking: false, drinking: false, otherPreferences: "" },
  preference: {
    minAge: "",
    maxAge: "",
    preferredCountry: "",
    preferredCity: "",
    preferredArea: "",
    minEducation: "",
    preferredEducation: "",
    professionPreference: "ANY",
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
  consent: { agreed: false },
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
