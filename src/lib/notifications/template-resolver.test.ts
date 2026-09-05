import { describe, it, expect } from "vitest";
import { substituteVariables, pickLocaleCopy, SAFE_VARIABLES } from "@/lib/notifications/template-resolver";

describe("substituteVariables", () => {
  it("substitutes an allow-listed variable", () => {
    expect(substituteVariables("Ref: {{profile_id}}", { profile_id: "LPP-000001" }, SAFE_VARIABLES)).toBe("Ref: LPP-000001");
  });

  it("drops a variable not on the allow-list", () => {
    expect(substituteVariables("Name: {{full_name}}", { full_name: "Ali Khan" }, SAFE_VARIABLES)).toBe("Name: ");
  });

  it("drops an allow-listed variable with no value supplied", () => {
    expect(substituteVariables("Meeting: {{meeting_date}}", {}, SAFE_VARIABLES)).toBe("Meeting: ");
  });

  it("leaves text with no placeholders unchanged", () => {
    expect(substituteVariables("You have a new matrimonial update.", {}, SAFE_VARIABLES)).toBe("You have a new matrimonial update.");
  });

  it("substitutes multiple variables in one string", () => {
    expect(substituteVariables("{{meeting_date}} at {{meeting_time}}", { meeting_date: "10 Sep", meeting_time: "5pm" }, SAFE_VARIABLES)).toBe(
      "10 Sep at 5pm"
    );
  });
});

describe("pickLocaleCopy", () => {
  const dict = { EN: "hello", UR: "" } as unknown as Record<"EN" | "UR", string>;

  it("returns the English entry when EN is requested", () => {
    expect(pickLocaleCopy(dict, "EN")).toBe("hello");
  });

  it("falls back to English when the Urdu entry is falsy", () => {
    const missingUr = { EN: "hello" } as Record<"EN" | "UR", string>;
    expect(pickLocaleCopy(missingUr, "UR")).toBe("hello");
  });
});
