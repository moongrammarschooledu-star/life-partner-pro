import { describe, it, expect } from "vitest";
import { toDetailDto, toListDto, toCandidateCardDto, type ProfileDetail, type ProfileListItem } from "./serializers";

// Minimal fixtures — only the fields toDetailDto/toListDto actually read.
function detailFixture(overrides: Partial<ProfileDetail> = {}): ProfileDetail {
  return {
    id: "p1",
    profileCode: "LPP-000001",
    fullName: "Test Person",
    gender: "MALE",
    dateOfBirth: new Date("1995-01-01"),
    maritalStatus: "NEVER_MARRIED",
    hasChildren: null,
    numberOfChildren: null,
    heightCm: 175,
    city: "Lahore",
    area: null,
    country: "Pakistan",
    nationality: null,
    status: "ACTIVE",
    verified: true,
    softDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    education: { id: "e1", profileId: "p1", level: "Bachelors", degree: null, institution: null },
    profession: { id: "pr1", profileId: "p1", profession: "Engineer", jobTitle: null, companyName: null, employmentType: "PRIVATE", monthlyIncome: 100000, annualIncome: 1200000, workLocation: null, businessDetails: null, program: null, expectedGraduation: null },
    family: { id: "f1", profileId: "p1", fatherOccupation: "Business", motherOccupation: "Homemaker", numberOfBrothers: 1, numberOfSisters: 1, familyType: "NUCLEAR", familyStatus: "MIDDLE_CLASS", familyLocation: null, familyBackground: null, additionalInfo: null },
    lifestyle: { id: "l1", profileId: "p1", religion: "Islam", sect: "Sunni", religiousPractice: "Practicing", languages: "Urdu, English", smoking: false, drinking: false, hobbies: null, personality: null, aboutMe: null, otherPreferences: null },
    preference: null,
    photos: [],
    notes: [],
    consent: null,
    pendingUpdate: null,
    ...overrides,
  } as unknown as ProfileDetail;
}

function listFixture(overrides: Partial<ProfileListItem> = {}): ProfileListItem {
  return {
    id: "p1",
    profileCode: "LPP-000001",
    fullName: "Test Person",
    gender: "MALE",
    dateOfBirth: new Date("1995-01-01"),
    city: "Lahore",
    country: "Pakistan",
    status: "ACTIVE",
    verified: true,
    profileCompletion: 80,
    createdAt: new Date(),
    education: { id: "e1", profileId: "p1", level: "Bachelors", degree: null, institution: null },
    profession: { id: "pr1", profileId: "p1", profession: "Engineer", jobTitle: null, companyName: null, employmentType: "PRIVATE", monthlyIncome: 100000, annualIncome: 1200000, workLocation: null, businessDetails: null, program: null, expectedGraduation: null },
    photos: [],
    ...overrides,
  } as unknown as ProfileListItem;
}

describe("toDetailDto — sensitive:income:view (pre-existing, regression guard)", () => {
  it("nulls monthlyIncome/annualIncome without the permission", () => {
    const dto = toDetailDto(detailFixture(), "admin1", []);
    expect(dto.profession?.monthlyIncome).toBeNull();
    expect(dto.profession?.annualIncome).toBeNull();
  });

  it("exposes income with sensitive:income:view", () => {
    const dto = toDetailDto(detailFixture(), "admin1", ["sensitive:income:view" as never]);
    expect(dto.profession?.monthlyIncome).toBe(100000);
  });
});

describe("toDetailDto — sensitive:family:view (STEP 20 — closes a real pre-existing gap)", () => {
  it("nulls family entirely without the permission", () => {
    const dto = toDetailDto(detailFixture(), "admin1", []);
    expect(dto.family).toBeNull();
  });

  it("nulls religion/sect/religiousPractice on lifestyle without the permission, but keeps other lifestyle fields", () => {
    const dto = toDetailDto(detailFixture(), "admin1", []);
    expect(dto.lifestyle?.religion).toBeNull();
    expect(dto.lifestyle?.sect).toBeNull();
    expect(dto.lifestyle?.religiousPractice).toBeNull();
    expect(dto.lifestyle?.languages).toBe("Urdu, English");
    expect(dto.lifestyle?.smoking).toBe(false);
  });

  it("exposes family and religious fields with sensitive:family:view", () => {
    const dto = toDetailDto(detailFixture(), "admin1", ["sensitive:family:view" as never]);
    expect(dto.family?.fatherOccupation).toBe("Business");
    expect(dto.lifestyle?.religion).toBe("Islam");
  });
});

describe("toListDto (regression guard — untouched by this step)", () => {
  it("still redacts income the same way", () => {
    const dto = toListDto(listFixture(), []);
    expect(dto.monthlyIncome).toBeNull();
  });
});

describe("toCandidateCardDto (STEP 20 — new, reuses toListDto's redaction)", () => {
  it("builds a photo URL from the existing authenticated photo proxy route when a primary photo exists", () => {
    const dto = toCandidateCardDto(listFixture({ photos: [{ id: "photo1", isPrimary: true }] } as never), []);
    expect(dto.photoUrl).toBe("/api/admin/profiles/p1/photo/photo1");
  });

  it("returns a null photoUrl when there is no photo", () => {
    const dto = toCandidateCardDto(listFixture(), []);
    expect(dto.photoUrl).toBeNull();
  });

  it("still redacts income via the reused toListDto logic", () => {
    const dto = toCandidateCardDto(listFixture(), []);
    expect(dto.monthlyIncome).toBeNull();
  });
});
