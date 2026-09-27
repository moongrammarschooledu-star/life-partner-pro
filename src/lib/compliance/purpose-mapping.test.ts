import { describe, it, expect } from "vitest";
import { resolvePurposeForPermission } from "./purpose-mapping";

describe("resolvePurposeForPermission", () => {
  it("maps a plain module permission to its purpose", () => {
    expect(resolvePurposeForPermission("verification:approve" as never)).toBe("IDENTITY_VERIFICATION");
    expect(resolvePurposeForPermission("finance:refund:approve" as never)).toBe("PAYMENT_PROCESSING");
    expect(resolvePurposeForPermission("contact:reveal" as never)).toBe("CONTACT_SHARING");
  });

  it("resolves a sensitive:* permission from its second segment, not the literal word 'sensitive'", () => {
    expect(resolvePurposeForPermission("sensitive:contact:view" as never)).toBe("CONTACT_SHARING");
    expect(resolvePurposeForPermission("sensitive:verification:view" as never)).toBe("IDENTITY_VERIFICATION");
  });

  it("falls back to ACCOUNT_OPERATION for an unmapped module rather than throwing", () => {
    expect(resolvePurposeForPermission("totally-unknown-module:x" as never)).toBe("ACCOUNT_OPERATION");
  });
});
