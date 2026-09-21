import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { COUNTRIES, citiesFor } from "@/lib/geo-data";

// Spec §44/§45 — natural-language search. The text is converted into a small,
// STRICTLY VALIDATED filter object; only that object is turned into a Prisma
// `where`. There is no raw SQL, no free field names, no free operators, and
// sensitive fields (income, contact details, notes) are simply not in the
// allow-list, so they cannot be searched through the assistant at all.

export const MAX_LIMIT = 25;
export const MAX_CONDITIONS = 8;

const text = z.string().trim().min(2).max(40).regex(/^[\p{L}][\p{L} .'-]*$/u, "Invalid text value");

export const searchFilterSchema = z
  .object({
    gender: z.enum(["MALE", "FEMALE"]).optional(),
    ageMin: z.number().int().min(18).max(90).optional(),
    ageMax: z.number().int().min(18).max(90).optional(),
    city: text.optional(),
    country: text.optional(),
    maritalStatus: z.enum(["NEVER_MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"]).optional(),
    educationLevel: z.enum(["Primary", "Middle", "Matric", "Intermediate", "Diploma", "Bachelors", "Masters", "MPhil", "PhD"]).optional(),
    profession: text.optional(),
    verifiedOnly: z.boolean().optional(),
    activeOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(10),
  })
  .strict(); // any unknown key (e.g. "monthlyIncome", "where", "$queryRaw") is rejected

export type SearchFilter = z.infer<typeof searchFilterSchema>;

export function validateFilter(input: unknown): SearchFilter {
  const parsed = searchFilterSchema.safeParse(input);
  if (!parsed.success) throw new Error("The search could not be understood safely.");
  const f = parsed.data;
  if (f.ageMin != null && f.ageMax != null && f.ageMin > f.ageMax) throw new Error("The age range is not valid.");
  const conditions = Object.entries(f).filter(([k, v]) => k !== "limit" && v !== undefined).length;
  if (conditions > MAX_CONDITIONS) throw new Error("The search is too complex.");
  return f;
}

const KNOWN_CITIES = new Map<string, string>();
for (const country of COUNTRIES) for (const c of citiesFor(country)) KNOWN_CITIES.set(c.toLowerCase(), c);
const KNOWN_COUNTRIES = new Map(COUNTRIES.map((c) => [c.toLowerCase(), c]));

const UNSUPPORTED = /\b(income|salary|earn(s|ing)?|phone|mobile|whatsapp|e-?mail|address|cnic|photo|picture|password|note|notes|document|bank|payment)\b/i;

export interface ParsedSearch {
  filter: Record<string, unknown>;
  unsupported: string[];
}

// Pure text → candidate filter. The result is untrusted and MUST go through
// validateFilter() before use.
export function parseSearchQuery(raw: string): ParsedSearch {
  const q = raw.toLowerCase();
  const filter: Record<string, unknown> = {};
  const unsupported: string[] = [];

  if (UNSUPPORTED.test(raw)) unsupported.push("Search by income, contact details, notes, documents or payments is not available through the assistant.");
  if (/\bwith education preference matching this profile\b|\bmatching this profile\b/.test(q)) unsupported.push("Matching against a specific profile is done with the Matching Center, not the search assistant.");

  if (/\bfemales?\b|\bwom[ae]n\b|\bbrides?\b|\bgirls?\b/.test(q)) filter.gender = "FEMALE";
  else if (/\bmales?\b|\bmen\b|\bgrooms?\b|\bboys?\b/.test(q)) filter.gender = "MALE";

  const range = q.match(/\b(\d{2})\s*(?:to|-|and|se)\s*(\d{2})\b/);
  if (range) {
    filter.ageMin = Number(range[1]);
    filter.ageMax = Number(range[2]);
  } else {
    const above = q.match(/\b(?:above|over|older than|at least)\s+(\d{2})\b/);
    const under = q.match(/\b(?:under|below|younger than|at most)\s+(\d{2})\b/);
    if (above) filter.ageMin = Number(above[1]);
    if (under) filter.ageMax = Number(under[1]);
  }

  for (const [lower, city] of KNOWN_CITIES) {
    if (new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q)) {
      filter.city = city;
      break;
    }
  }
  for (const [lower, country] of KNOWN_COUNTRIES) {
    if (new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(q)) {
      filter.country = country;
      break;
    }
  }

  if (/\bnever married\b|\bunmarried\b|\bsingle\b/.test(q)) filter.maritalStatus = "NEVER_MARRIED";
  else if (/\bdivorced\b/.test(q)) filter.maritalStatus = "DIVORCED";
  else if (/\bwidow(ed|er)?\b/.test(q)) filter.maritalStatus = "WIDOWED";
  else if (/\bseparated\b/.test(q)) filter.maritalStatus = "SEPARATED";

  if (/\bph\.?d\b|\bdoctorate\b/.test(q)) filter.educationLevel = "PhD";
  else if (/\bm\.?phil\b/.test(q)) filter.educationLevel = "MPhil";
  else if (/\bmasters?\b|\bmba\b|\bm\.?sc\b/.test(q)) filter.educationLevel = "Masters";
  else if (/\bbachelors?\b|\bgraduate\b|\bb\.?sc\b|\bbba\b/.test(q)) filter.educationLevel = "Bachelors";
  else if (/\bintermediate\b|\ba-?level\b/.test(q)) filter.educationLevel = "Intermediate";
  else if (/\bdiploma\b/.test(q)) filter.educationLevel = "Diploma";
  else if (/\bmatric\b|\bo-?level\b/.test(q)) filter.educationLevel = "Matric";

  const job = q.match(/\b(doctor|engineer|teacher|lawyer|accountant|banker|pilot|nurse|professor|designer|developer|architect)s?\b/);
  if (job) filter.profession = job[1];

  if (/\bverified\b/.test(q)) filter.verifiedOnly = true;
  if (/\bactive\b/.test(q)) filter.activeOnly = true;
  const lim = q.match(/\b(?:top|first|limit)\s+(\d{1,2})\b/);
  if (lim) filter.limit = Math.min(MAX_LIMIT, Math.max(1, Number(lim[1])));

  return { filter, unsupported };
}

function yearsAgo(now: Date, years: number): Date {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

// Validated filter → Prisma where. `assignedIds` restricts STAFF to their
// assigned profiles (null = no row scoping for SUPER_ADMIN/ADMIN).
export function filterToWhere(f: SearchFilter, opts: { assignedIds: string[] | null; now?: Date }): Prisma.ProfileWhereInput {
  const now = opts.now ?? new Date();
  const where: Prisma.ProfileWhereInput = { softDeleted: false, accountStatus: "ACTIVE", status: { notIn: ["ARCHIVED", "REJECTED", "SUSPENDED"] } };
  const and: Prisma.ProfileWhereInput[] = [];
  if (opts.assignedIds) and.push({ id: { in: opts.assignedIds } });
  if (f.gender) and.push({ gender: f.gender });
  if (f.city) and.push({ city: { equals: f.city, mode: "insensitive" } });
  if (f.country) and.push({ country: { equals: f.country, mode: "insensitive" } });
  if (f.maritalStatus) and.push({ maritalStatus: f.maritalStatus });
  if (f.activeOnly) and.push({ status: "ACTIVE" });
  if (f.verifiedOnly) and.push({ verification: { is: { status: "VERIFIED" } } });
  if (f.educationLevel) and.push({ education: { is: { level: f.educationLevel } } });
  if (f.profession) and.push({ profession: { is: { profession: { contains: f.profession, mode: "insensitive" } } } });
  // age → date-of-birth window
  if (f.ageMin != null) and.push({ dateOfBirth: { lte: yearsAgo(now, f.ageMin) } });
  if (f.ageMax != null) and.push({ dateOfBirth: { gt: yearsAgo(now, f.ageMax + 1) } });
  return { ...where, AND: and };
}
