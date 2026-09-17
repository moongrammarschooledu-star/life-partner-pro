import { describe, it, expect } from "vitest";
import { isCategoryValidForType, categoriesForType, SUPPORT_CATEGORIES, COMPLAINT_CATEGORIES, SAFETY_CATEGORIES, PRIVACY_INCIDENT_CATEGORIES } from "./case-categories";

describe("isCategoryValidForType", () => {
  it("accepts a support category for SUPPORT", () => {
    expect(isCategoryValidForType("SUPPORT", "ACCOUNT_PROBLEM")).toBe(true);
  });

  it("rejects a complaint-only category for SUPPORT", () => {
    expect(isCategoryValidForType("SUPPORT", "STAFF_CONDUCT_COMPLAINT")).toBe(false);
  });

  it("accepts a category shared between COMPLAINT and SAFETY_REPORT for either type", () => {
    expect(isCategoryValidForType("COMPLAINT", "HARASSMENT")).toBe(true);
    expect(isCategoryValidForType("SAFETY_REPORT", "HARASSMENT")).toBe(true);
  });

  it("accepts any known category for INTERNAL, including privacy-incident categories (STEP 13)", () => {
    expect(isCategoryValidForType("INTERNAL", "ACCOUNT_PROBLEM")).toBe(true);
    expect(isCategoryValidForType("INTERNAL", "STAFF_CONDUCT_COMPLAINT")).toBe(true);
    expect(isCategoryValidForType("INTERNAL", "THREATENING_BEHAVIOR")).toBe(true);
    expect(isCategoryValidForType("INTERNAL", "UNAUTHORIZED_DATA_ACCESS")).toBe(true);
  });

  it("accepts a privacy-incident category for PRIVACY_INCIDENT but not for SUPPORT", () => {
    expect(isCategoryValidForType("PRIVACY_INCIDENT", "STAFF_ACCESS_VIOLATION")).toBe(true);
    expect(isCategoryValidForType("SUPPORT", "STAFF_ACCESS_VIOLATION")).toBe(false);
  });
});

describe("categoriesForType", () => {
  it("returns exactly the support category list for SUPPORT", () => {
    expect(categoriesForType("SUPPORT")).toEqual(SUPPORT_CATEGORIES);
  });

  it("returns the union of all category lists for INTERNAL, including privacy-incident categories (STEP 13)", () => {
    const internal = categoriesForType("INTERNAL");
    expect(internal.length).toBe(SUPPORT_CATEGORIES.length + COMPLAINT_CATEGORIES.length + SAFETY_CATEGORIES.length + PRIVACY_INCIDENT_CATEGORIES.length);
  });

  it("returns exactly the privacy-incident category list for PRIVACY_INCIDENT", () => {
    expect(categoriesForType("PRIVACY_INCIDENT")).toEqual(PRIVACY_INCIDENT_CATEGORIES);
  });
});
