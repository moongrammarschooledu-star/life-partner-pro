"use client";

import { Field, Input, Select, Checkbox } from "@/components/ui/form";

export interface MatchFilters {
  minScore: string;
  city: string;
  education: string;
  profession: string;
  minAge: string;
  maxAge: string;
  maritalStatus: string;
  familyType: string;
  religion: string;
  minCompleteness: string;
  verifiedOnly: boolean;
  activeOnly: boolean;
  includeAllEligible: boolean;
  sort: string;
}

export const emptyMatchFilters: MatchFilters = {
  minScore: "40",
  city: "",
  education: "",
  profession: "",
  minAge: "",
  maxAge: "",
  maritalStatus: "",
  familyType: "",
  religion: "",
  minCompleteness: "",
  verifiedOnly: false,
  activeOnly: false,
  includeAllEligible: false,
  sort: "highest",
};

const SORT_OPTIONS = [
  { value: "highest", label: "Highest Match" },
  { value: "lowest", label: "Lowest Match" },
  { value: "newest", label: "Newest Profile" },
  { value: "same_city", label: "Same City" },
  { value: "same_area", label: "Same Area" },
  { value: "age_closest", label: "Age Closest" },
  { value: "education_closest", label: "Education Closest" },
  { value: "profession_closest", label: "Profession Closest" },
  { value: "most_complete", label: "Most Complete" },
  { value: "recently_active", label: "Recently Active" },
];

export function MatchFiltersBar({
  filters,
  onChange,
  seekerCity,
  seekerArea,
}: {
  filters: MatchFilters;
  onChange: (f: MatchFilters) => void;
  seekerCity?: string;
  seekerArea?: string | null;
}) {
  function set<K extends keyof MatchFilters>(key: K, value: MatchFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Sort" htmlFor="sort">
          <Select id="sort" value={filters.sort} onChange={(e) => set("sort", e.target.value)}>
            {SORT_OPTIONS.map((o) => (
              <option
                key={o.value}
                value={o.value}
                disabled={(o.value === "same_city" && !seekerCity) || (o.value === "same_area" && !seekerArea)}
              >
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minimum Score" htmlFor="minScore">
          <Input id="minScore" type="number" min={0} max={100} value={filters.minScore} onChange={(e) => set("minScore", e.target.value)} />
        </Field>
        <Field label="City" htmlFor="matchCity">
          <Input id="matchCity" value={filters.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Education" htmlFor="matchEducation">
          <Input id="matchEducation" value={filters.education} onChange={(e) => set("education", e.target.value)} />
        </Field>
        <Field label="Profession" htmlFor="matchProfession">
          <Input id="matchProfession" value={filters.profession} onChange={(e) => set("profession", e.target.value)} />
        </Field>
        <Field label="Min Age" htmlFor="matchMinAge">
          <Input id="matchMinAge" type="number" min={18} value={filters.minAge} onChange={(e) => set("minAge", e.target.value)} />
        </Field>
        <Field label="Max Age" htmlFor="matchMaxAge">
          <Input id="matchMaxAge" type="number" min={18} value={filters.maxAge} onChange={(e) => set("maxAge", e.target.value)} />
        </Field>
        <Field label="Marital Status" htmlFor="matchMaritalStatus">
          <Select id="matchMaritalStatus" value={filters.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
            <option value="">Any</option>
            <option value="NEVER_MARRIED">Never Married</option>
            <option value="DIVORCED">Divorced</option>
            <option value="WIDOWED">Widowed</option>
            <option value="SEPARATED">Separated</option>
            <option value="OTHER">Other</option>
          </Select>
        </Field>
        <Field label="Family Type" htmlFor="matchFamilyType">
          <Select id="matchFamilyType" value={filters.familyType} onChange={(e) => set("familyType", e.target.value)}>
            <option value="">Any</option>
            <option value="NUCLEAR">Nuclear</option>
            <option value="JOINT">Joint</option>
            <option value="EXTENDED">Extended</option>
          </Select>
        </Field>
        <Field label="Religion" htmlFor="matchReligion">
          <Input id="matchReligion" value={filters.religion} onChange={(e) => set("religion", e.target.value)} />
        </Field>
        <Field label="Min Profile Completeness %" htmlFor="matchMinCompleteness">
          <Input
            id="matchMinCompleteness"
            type="number"
            min={0}
            max={100}
            value={filters.minCompleteness}
            onChange={(e) => set("minCompleteness", e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-4 pb-1">
          <Checkbox label="Verified only" checked={filters.verifiedOnly} onChange={(e) => set("verifiedOnly", e.target.checked)} />
          <Checkbox label="Active only" checked={filters.activeOnly} onChange={(e) => set("activeOnly", e.target.checked)} />
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <Checkbox
          label="Include all eligible statuses (not just Verified + Active)"
          checked={filters.includeAllEligible}
          onChange={(e) => set("includeAllEligible", e.target.checked)}
        />
      </div>
    </div>
  );
}
