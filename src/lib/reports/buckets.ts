import { prisma } from "@/lib/prisma";

export interface RangeBucket {
  label: string;
  min: number | null; // null = no lower bound
  max: number | null; // null = no upper bound
}

export interface CategoryBucket {
  key: string;
  label: string;
}

// Spec §5 — 8 age buckets, admin-configurable via AppSettings.ageRangeBuckets.
export const DEFAULT_AGE_BUCKETS: RangeBucket[] = [
  { label: "Under 20", min: null, max: 19 },
  { label: "20–24", min: 20, max: 24 },
  { label: "25–29", min: 25, max: 29 },
  { label: "30–34", min: 30, max: 34 },
  { label: "35–39", min: 35, max: 39 },
  { label: "40–44", min: 40, max: 44 },
  { label: "45–49", min: 45, max: 49 },
  { label: "50+", min: 50, max: null },
];

// Spec §9 — 5 income buckets, admin-configurable via AppSettings.incomeRangeBuckets.
export const DEFAULT_INCOME_BUCKETS: RangeBucket[] = [
  { label: "Below 50K", min: null, max: 49_999 },
  { label: "50K–100K", min: 50_000, max: 99_999 },
  { label: "100K–200K", min: 100_000, max: 199_999 },
  { label: "200K–500K", min: 200_000, max: 499_999 },
  { label: "500K+", min: 500_000, max: null },
];

// Spec §8 — 11 profession categories, admin-extendable via
// AppSettings.professionCategories. `key` is stored/matched case-insensitively
// against ProfessionInfo.profession free text; "OTHER" is the catch-all.
export const DEFAULT_PROFESSION_CATEGORIES: CategoryBucket[] = [
  { key: "BUSINESS", label: "Business" },
  { key: "GOVERNMENT", label: "Government Job" },
  { key: "PRIVATE", label: "Private Job" },
  { key: "SELF_EMPLOYED", label: "Self Employed" },
  { key: "TEACHER", label: "Teacher" },
  { key: "DOCTOR", label: "Doctor" },
  { key: "ENGINEER", label: "Engineer" },
  { key: "IT_SOFTWARE", label: "IT / Software" },
  { key: "BANKING_FINANCE", label: "Banking / Finance" },
  { key: "FREELANCER", label: "Freelancer" },
  { key: "OTHER", label: "Other" },
];

function inRange(value: number, bucket: RangeBucket): boolean {
  if (bucket.min != null && value < bucket.min) return false;
  if (bucket.max != null && value > bucket.max) return false;
  return true;
}

// Pure — returns the bucket label a value falls into, or null if no bucket
// matches (buckets are expected to be exhaustive/contiguous by construction).
export function assignRangeBucket(value: number, buckets: RangeBucket[]): string | null {
  const match = buckets.find((b) => inRange(value, b));
  return match?.label ?? null;
}

export async function loadBucketConfig(): Promise<{ age: RangeBucket[]; income: RangeBucket[]; profession: CategoryBucket[] }> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  return {
    age: (settings?.ageRangeBuckets as RangeBucket[] | null) ?? DEFAULT_AGE_BUCKETS,
    income: (settings?.incomeRangeBuckets as RangeBucket[] | null) ?? DEFAULT_INCOME_BUCKETS,
    profession: (settings?.professionCategories as CategoryBucket[] | null) ?? DEFAULT_PROFESSION_CATEGORIES,
  };
}
