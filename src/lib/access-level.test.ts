import { describe, it, expect } from "vitest";
import { meetsAccessLevel, ACCESS_LEVELS, type AccessLevel } from "@/lib/access-level";

describe("meetsAccessLevel (spec §3 ordering)", () => {
  it("a level always meets itself", () => {
    for (const level of ACCESS_LEVELS) expect(meetsAccessLevel(level, level)).toBe(true);
  });

  it("orders VIEW < COMMENT < EDIT < MANAGE < APPROVE < OWNER", () => {
    for (let i = 0; i < ACCESS_LEVELS.length; i++) {
      for (let j = 0; j < ACCESS_LEVELS.length; j++) {
        expect(meetsAccessLevel(ACCESS_LEVELS[i], ACCESS_LEVELS[j])).toBe(i >= j);
      }
    }
  });

  it("OWNER satisfies every requirement; VIEW satisfies only VIEW", () => {
    for (const required of ACCESS_LEVELS) expect(meetsAccessLevel("OWNER", required)).toBe(true);
    const failing: AccessLevel[] = ["COMMENT", "EDIT", "MANAGE", "APPROVE", "OWNER"];
    for (const required of failing) expect(meetsAccessLevel("VIEW", required)).toBe(false);
  });
});
