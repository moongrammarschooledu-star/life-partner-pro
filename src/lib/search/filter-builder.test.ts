import { describe, it, expect } from "vitest";
import { validateFilterGroup, buildWhereFromFilterGroup, FilterValidationError, type FilterGroup } from "./filter-builder";

const NOW = new Date("2026-01-01T00:00:00Z");

describe("validateFilterGroup", () => {
  it("accepts a simple AND group of allow-listed fields", () => {
    const group = validateFilterGroup({ op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }, { field: "verified", op: "eq", value: true }] }, []);
    expect(group.op).toBe("AND");
  });

  it("accepts nested AND/OR groups (spec §18 example)", () => {
    const raw: FilterGroup = {
      op: "AND",
      rules: [
        { field: "age", op: "gte", value: 25 },
        { field: "age", op: "lte", value: 32 },
        { op: "OR", rules: [{ field: "city", op: "eq", value: "Lahore" }, { field: "city", op: "eq", value: "Islamabad" }] },
      ],
    };
    expect(() => validateFilterGroup(raw, [])).not.toThrow();
  });

  it("rejects an unknown field (no injection surface)", () => {
    expect(() => validateFilterGroup({ op: "AND", rules: [{ field: "$where", op: "eq", value: "1=1" }] }, [])).toThrow(FilterValidationError);
  });

  it("rejects a sensitive field never in the allow-list at all (income)", () => {
    expect(() => validateFilterGroup({ op: "AND", rules: [{ field: "monthlyIncome", op: "gte", value: 1 }] }, ["sensitive:income:view" as never])).toThrow(FilterValidationError);
  });

  it("rejects an operator not valid for the field", () => {
    expect(() => validateFilterGroup({ op: "AND", rules: [{ field: "gender", op: "contains", value: "MALE" }] }, [])).toThrow(FilterValidationError);
  });

  it("rejects a sensitive-but-listed field (religion) without sensitive:family:view", () => {
    expect(() => validateFilterGroup({ op: "AND", rules: [{ field: "religion", op: "eq", value: "Islam" }] }, [])).toThrow(FilterValidationError);
  });

  it("allows the sensitive-but-listed field once the permission is held", () => {
    expect(() => validateFilterGroup({ op: "AND", rules: [{ field: "religion", op: "eq", value: "Islam" }] }, ["sensitive:family:view" as never])).not.toThrow();
  });

  it("rejects a filter with too many total conditions", () => {
    const rules = Array.from({ length: 30 }, () => ({ field: "city", op: "eq" as const, value: "Lahore" }));
    expect(() => validateFilterGroup({ op: "AND", rules }, [])).toThrow(FilterValidationError);
  });

  it("rejects a filter nested too deeply", () => {
    let group: FilterGroup = { op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }] };
    for (let i = 0; i < 6; i++) group = { op: "AND", rules: [group] };
    expect(() => validateFilterGroup(group, [])).toThrow(FilterValidationError);
  });

  it("rejects an invalid enum value", () => {
    expect(() => validateFilterGroup({ op: "AND", rules: [{ field: "gender", op: "eq", value: "OTHER" }] }, [])).toThrow(FilterValidationError);
  });
});

describe("buildWhereFromFilterGroup", () => {
  it("compiles a simple root-field rule", () => {
    const group = validateFilterGroup({ op: "AND", rules: [{ field: "city", op: "eq", value: "Lahore" }] }, []);
    const where = buildWhereFromFilterGroup(group, NOW) as { AND: unknown[] };
    expect(Array.isArray(where.AND)).toBe(true);
    expect(where.AND).toHaveLength(1);
  });

  it("compiles a relation field (educationLevel) into a nested `is` filter", () => {
    const group = validateFilterGroup({ op: "AND", rules: [{ field: "educationLevel", op: "eq", value: "Bachelors" }] }, []);
    const where = buildWhereFromFilterGroup(group, NOW) as { AND: Array<{ education?: { is?: { level?: unknown } } }> };
    expect(where.AND[0].education?.is?.level).toEqual({ equals: "Bachelors", mode: "insensitive" });
  });

  it("compiles an ordinal educationLevel>=Bachelors into an `in` set of qualifying levels", () => {
    const group = validateFilterGroup({ op: "AND", rules: [{ field: "educationLevel", op: "gte", value: "Bachelors" }] }, []);
    const where = buildWhereFromFilterGroup(group, NOW) as { AND: Array<{ education?: { is?: { level?: { in?: string[] } } } }> };
    const levels = where.AND[0].education!.is!.level!.in!;
    expect(levels).toContain("Bachelors");
    expect(levels).toContain("PhD");
    expect(levels).not.toContain("Matric");
  });

  it("compiles age into a dateOfBirth window", () => {
    const group = validateFilterGroup({ op: "AND", rules: [{ field: "age", op: "gte", value: 25 }, { field: "age", op: "lte", value: 32 }] }, []);
    const where = buildWhereFromFilterGroup(group, NOW) as { AND: Array<{ dateOfBirth?: unknown }> };
    expect(where.AND[0].dateOfBirth).toBeDefined();
    expect(where.AND[1].dateOfBirth).toBeDefined();
  });

  it("compiles nested OR groups correctly (spec §18's city-OR example)", () => {
    const group = validateFilterGroup(
      { op: "OR", rules: [{ field: "city", op: "eq", value: "Lahore" }, { field: "city", op: "eq", value: "Islamabad" }] },
      []
    );
    const where = buildWhereFromFilterGroup(group, NOW) as { OR: unknown[] };
    expect(where.OR).toHaveLength(2);
  });

  it("never produces a raw string SQL fragment anywhere in the compiled output", () => {
    const group = validateFilterGroup({ op: "AND", rules: [{ field: "city", op: "contains", value: "Lah'ore; DROP TABLE Profile;--" }] }, []);
    const where = buildWhereFromFilterGroup(group, NOW) as { AND: Array<{ city?: { contains?: string } }> };
    // The malicious string is treated as an ordinary parameterized value by
    // Prisma's query builder — it never becomes part of a SQL string here.
    expect(where.AND[0].city?.contains).toBe("Lah'ore; DROP TABLE Profile;--");
    expect(typeof where).toBe("object");
  });
});
