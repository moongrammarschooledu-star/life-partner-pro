import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import { getFieldDef, EDUCATION_LEVEL_ORDER, educationLevelRank, type ComparisonOp } from "@/lib/search/fields";

// STEP 20 §18 — the Smart Filter Builder compiles a validated AST into a
// Prisma.ProfileWhereInput. There is no string concatenation anywhere in
// this file, no raw SQL, and no field/operator that isn't in
// src/lib/search/fields.ts's SEARCHABLE_FIELDS allow-list — structurally
// identical in spirit to src/lib/ai/copilot/nl-filter.ts's guarantee.

export class FilterValidationError extends Error {}

const MAX_RULES = 25;
const MAX_DEPTH = 4;

export interface FilterRule {
  field: string;
  op: ComparisonOp;
  value: unknown;
}
export interface FilterGroup {
  op: "AND" | "OR";
  rules: Array<FilterRule | FilterGroup>;
}

function isGroup(x: FilterRule | FilterGroup): x is FilterGroup {
  return (x as FilterGroup).op === "AND" || (x as FilterGroup).op === "OR";
}

const ruleSchema: z.ZodType<FilterRule> = z.object({
  field: z.string().min(1).max(64),
  op: z.enum(["eq", "neq", "contains", "gte", "lte", "in", "between"]),
  value: z.unknown(),
});

// z.lazy for the recursive FilterGroup shape.
const groupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    op: z.enum(["AND", "OR"]),
    rules: z.array(z.union([ruleSchema, groupSchema])).min(1).max(MAX_RULES),
  })
);

function countRules(group: FilterGroup): number {
  let n = 0;
  for (const r of group.rules) n += isGroup(r) ? countRules(r) : 1;
  return n;
}

function depthOf(group: FilterGroup): number {
  let max = 1;
  for (const r of group.rules) if (isGroup(r)) max = Math.max(max, 1 + depthOf(r));
  return max;
}

// Validates the raw shape AND that every field/op is allow-listed and that
// any sensitive field's permission is actually held by the caller — the
// single choke point every search API route must call before compiling.
export function validateFilterGroup(input: unknown, permissions: Permission[]): FilterGroup {
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) throw new FilterValidationError("The filter could not be understood — invalid structure.");
  const group = parsed.data;

  if (countRules(group) > MAX_RULES) throw new FilterValidationError(`A search filter cannot have more than ${MAX_RULES} conditions.`);
  if (depthOf(group) > MAX_DEPTH) throw new FilterValidationError("This filter is nested too deeply.");

  function walk(g: FilterGroup) {
    for (const r of g.rules) {
      if (isGroup(r)) {
        walk(r);
        continue;
      }
      const def = getFieldDef(r.field);
      if (!def) throw new FilterValidationError(`"${r.field}" is not a searchable field.`);
      if (!def.ops.includes(r.op)) throw new FilterValidationError(`"${r.op}" is not a valid operator for "${def.label}".`);
      if (def.sensitivePermission && !permissions.includes(def.sensitivePermission)) {
        throw new FilterValidationError(`You do not have permission to filter by "${def.label}".`);
      }
      if (def.enumValues && (r.op === "eq" || r.op === "neq") && typeof r.value === "string" && !def.enumValues.includes(r.value)) {
        throw new FilterValidationError(`"${r.value}" is not a valid value for "${def.label}".`);
      }
    }
  }
  walk(group);
  return group;
}

const ROOT_FIELDS = new Set(["fullName", "profileCode", "gender", "maritalStatus", "heightCm", "city", "area", "country", "status", "verified"]);
const RELATION_FOR: Record<string, string> = {
  verificationStatus: "verification",
  educationLevel: "education",
  degree: "education",
  institution: "education",
  profession: "profession",
  jobTitle: "profession",
  companyName: "profession",
  employmentType: "profession",
  workLocation: "profession",
  languages: "lifestyle",
  smoking: "lifestyle",
  drinking: "lifestyle",
  religion: "lifestyle",
  sect: "lifestyle",
  religiousPractice: "lifestyle",
  familyType: "family",
  familyStatus: "family",
  fatherOccupation: "family",
  motherOccupation: "family",
};
// The actual column name on the related model, where it differs from the
// search field's own name (e.g. "verificationStatus" -> ProfileVerification.status,
// "educationLevel" -> EducationInfo.level).
const RELATION_COLUMN: Record<string, string> = { verificationStatus: "status", educationLevel: "level" };

function yearsAgo(now: Date, years: number): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

function scalarFilter(def: ReturnType<typeof getFieldDef>, rule: FilterRule): Record<string, unknown> {
  const { op, value } = rule;
  const isText = def!.type === "string";
  switch (op) {
    case "eq":
      return isText ? { equals: value, mode: "insensitive" } : { equals: value };
    case "neq":
      return isText ? { not: { equals: value, mode: "insensitive" } } : { not: value };
    case "contains":
      return { contains: value as string, mode: "insensitive" };
    case "gte":
      return { gte: value };
    case "lte":
      return { lte: value };
    case "in":
      return isText ? { in: value as string[] } : { in: value as unknown[] };
    case "between": {
      const [lo, hi] = value as [number, number];
      return { gte: lo, lte: hi };
    }
  }
}

// Compiles ONE validated rule into a Prisma.ProfileWhereInput fragment.
// `age` is virtual (maps to dateOfBirth); `educationLevel`'s "gte" op is an
// ordinal comparison against EDUCATION_LEVEL_ORDER (spec §9), resolved to an
// `in` set since education level is stored as free text, not a DB enum.
function compileRule(rule: FilterRule, now: Date): Prisma.ProfileWhereInput {
  const def = getFieldDef(rule.field);
  if (!def) throw new FilterValidationError(`"${rule.field}" is not a searchable field.`);

  if (rule.field === "age") {
    if (rule.op === "gte") return { dateOfBirth: { lte: yearsAgo(now, rule.value as number) } };
    if (rule.op === "lte") return { dateOfBirth: { gte: yearsAgo(now, (rule.value as number) + 1) } };
    if (rule.op === "eq") return { dateOfBirth: { gt: yearsAgo(now, (rule.value as number) + 1), lte: yearsAgo(now, rule.value as number) } };
    if (rule.op === "between") {
      const [lo, hi] = rule.value as [number, number];
      return { dateOfBirth: { gt: yearsAgo(now, hi + 1), lte: yearsAgo(now, lo) } };
    }
    throw new FilterValidationError(`"${rule.op}" is not supported for age.`);
  }

  if (rule.field === "educationLevel" && rule.op === "gte") {
    const minRank = educationLevelRank(rule.value as string);
    const qualifying = EDUCATION_LEVEL_ORDER.filter((_, idx) => idx >= minRank);
    return { education: { is: { level: { in: [...qualifying] } } } };
  }

  const filter = scalarFilter(def, rule);
  if (ROOT_FIELDS.has(rule.field)) return { [rule.field]: filter } as Prisma.ProfileWhereInput;

  const relation = RELATION_FOR[rule.field];
  if (!relation) throw new FilterValidationError(`"${rule.field}" cannot be compiled — no known location.`);
  const column = RELATION_COLUMN[rule.field] ?? rule.field;
  return { [relation]: { is: { [column]: filter } } } as Prisma.ProfileWhereInput;
}

// The recursive AND/OR compiler (spec §18). Assumes `group` has already
// passed validateFilterGroup() — never call this on unvalidated input.
export function buildWhereFromFilterGroup(group: FilterGroup, now: Date = new Date()): Prisma.ProfileWhereInput {
  const compiled = group.rules.map((r) => (isGroup(r) ? buildWhereFromFilterGroup(r, now) : compileRule(r, now)));
  return group.op === "AND" ? { AND: compiled } : { OR: compiled };
}
