import { describe, it, expect } from "vitest";
import { meetsAccessLevel, minAccessLevel, ACCESS_LEVELS, type AccessLevel } from "@/lib/access-level";

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

// STEP 18 — a task's own accessLevel caps the source record's access.
describe("minAccessLevel", () => {
  it("returns the weaker of the two levels regardless of argument order", () => {
    expect(minAccessLevel("MANAGE", "VIEW")).toBe("VIEW");
    expect(minAccessLevel("VIEW", "MANAGE")).toBe("VIEW");
  });

  it("returns the same level when both sides are equal", () => {
    for (const level of ACCESS_LEVELS) expect(minAccessLevel(level, level)).toBe(level);
  });

  it("never returns a level stronger than either input", () => {
    for (const a of ACCESS_LEVELS) {
      for (const b of ACCESS_LEVELS) {
        const result = minAccessLevel(a, b);
        expect(meetsAccessLevel(a, result)).toBe(true);
        expect(meetsAccessLevel(b, result)).toBe(true);
      }
    }
  });
});
