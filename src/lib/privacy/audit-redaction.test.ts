import { describe, it, expect } from "vitest";
import { redactForAudit } from "./audit-redaction";

describe("redactForAudit", () => {
  it("masks a mobile number", () => {
    const result = redactForAudit({ mobileNumber: "+923001234567" });
    expect(result.mobileNumber).not.toBe("+923001234567");
    expect(String(result.mobileNumber)).toContain("4567");
  });

  it("masks an email address", () => {
    const result = redactForAudit({ email: "john.doe@example.com" });
    expect(result.email).not.toBe("john.doe@example.com");
    expect(String(result.email)).toContain("@example.com");
  });

  it("leaves non-sensitive keys untouched", () => {
    const result = redactForAudit({ caseId: "abc123", count: 5 });
    expect(result.caseId).toBe("abc123");
    expect(result.count).toBe(5);
  });

  it("leaves non-string values under sensitive keys untouched", () => {
    const result = redactForAudit({ email: null });
    expect(result.email).toBeNull();
  });
});
