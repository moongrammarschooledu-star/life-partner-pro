import { describe, it, expect } from "vitest";
import { validateTransition } from "./lifecycle-service";

describe("validateTransition", () => {
  it("allows the initial assignment from null", () => {
    expect(validateTransition(null, "REGISTERED")).toBe(true);
  });

  it("allows a forward move on the main path", () => {
    expect(validateTransition("REGISTERED", "PROFILE_INCOMPLETE")).toBe(true);
    expect(validateTransition("VERIFIED", "MATCHING")).toBe(true);
  });

  it("rejects a backward move on the main path", () => {
    expect(validateTransition("MATCHING", "VERIFIED")).toBe(false);
  });

  it("rejects a no-op transition to the same stage", () => {
    expect(validateTransition("ACTIVE", "ACTIVE")).toBe(false);
  });

  it("allows any active stage to move to an exit stage", () => {
    expect(validateTransition("PROPOSAL_ACTIVE", "ON_HOLD")).toBe(true);
    expect(validateTransition("REGISTERED", "REJECTED")).toBe(true);
    expect(validateTransition("MATCHING", "SUSPENDED")).toBe(true);
  });

  it("allows re-activation from an exit stage onto any main-path stage, forward or not", () => {
    expect(validateTransition("ON_HOLD", "ACTIVE")).toBe(true);
    expect(validateTransition("SUSPENDED", "MATCHING")).toBe(true);
  });

  it("rejects every transition once a terminal stage (MARRIED/ARCHIVED) is reached", () => {
    expect(validateTransition("MARRIED", "ACTIVE")).toBe(false);
    expect(validateTransition("MARRIED", "ARCHIVED")).toBe(false);
    expect(validateTransition("ARCHIVED", "ACTIVE")).toBe(false);
  });

  it("rejects a target that is neither a main-path stage nor an exit stage", () => {
    expect(validateTransition("ACTIVE", "NOT_A_REAL_STAGE" as never)).toBe(false);
  });
});
