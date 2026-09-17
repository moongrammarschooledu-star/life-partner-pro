import { describe, it, expect } from "vitest";
import { typePermissionFor } from "./case-type-permission";

describe("typePermissionFor", () => {
  it("maps SUPPORT view/create/resolve/close to support:* permissions", () => {
    expect(typePermissionFor("SUPPORT", "view")).toBe("support:view");
    expect(typePermissionFor("SUPPORT", "create")).toBe("support:create");
    expect(typePermissionFor("SUPPORT", "resolve")).toBe("support:resolve");
    expect(typePermissionFor("SUPPORT", "close")).toBe("support:close");
    expect(typePermissionFor("SUPPORT", "review")).toBeNull();
  });

  it("maps COMPLAINT view/create/review/resolve to complaints:* permissions", () => {
    expect(typePermissionFor("COMPLAINT", "view")).toBe("complaints:view");
    expect(typePermissionFor("COMPLAINT", "create")).toBe("complaints:create");
    expect(typePermissionFor("COMPLAINT", "review")).toBe("complaints:review");
    expect(typePermissionFor("COMPLAINT", "resolve")).toBe("complaints:resolve");
    expect(typePermissionFor("COMPLAINT", "close")).toBeNull();
  });

  it("maps SAFETY_REPORT view/review/resolve to safety_cases:* permissions", () => {
    expect(typePermissionFor("SAFETY_REPORT", "view")).toBe("safety_cases:view");
    expect(typePermissionFor("SAFETY_REPORT", "review")).toBe("safety_cases:review");
    expect(typePermissionFor("SAFETY_REPORT", "resolve")).toBe("safety_cases:resolve");
    expect(typePermissionFor("SAFETY_REPORT", "create")).toBeNull();
  });

  it("never requires a type-specific permission for INTERNAL cases", () => {
    expect(typePermissionFor("INTERNAL", "view")).toBeNull();
    expect(typePermissionFor("INTERNAL", "create")).toBeNull();
    expect(typePermissionFor("INTERNAL", "resolve")).toBeNull();
  });

  it("maps PRIVACY_INCIDENT view/review/resolve to privacy_incidents:* permissions (STEP 13)", () => {
    expect(typePermissionFor("PRIVACY_INCIDENT", "view")).toBe("privacy_incidents:view");
    expect(typePermissionFor("PRIVACY_INCIDENT", "review")).toBe("privacy_incidents:review");
    expect(typePermissionFor("PRIVACY_INCIDENT", "resolve")).toBe("privacy_incidents:resolve");
    expect(typePermissionFor("PRIVACY_INCIDENT", "create")).toBeNull();
    expect(typePermissionFor("PRIVACY_INCIDENT", "close")).toBeNull();
  });
});
