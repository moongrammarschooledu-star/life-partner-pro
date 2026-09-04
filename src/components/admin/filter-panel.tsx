"use client";

import { Search } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export interface ProfileFilters {
  q: string;
  gender: string;
  status: string;
  city: string;
  minAge: string;
  maxAge: string;
  education: string;
  profession: string;
  maritalStatus: string;
  verified: string;
}

export const emptyFilters: ProfileFilters = {
  q: "",
  gender: "",
  status: "",
  city: "",
  minAge: "",
  maxAge: "",
  education: "",
  profession: "",
  maritalStatus: "",
  verified: "",
};

const STATUS_OPTIONS = [
  "NEW", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "MATCHING", "PROPOSAL_SENT",
  "WAITING_FOR_RESPONSE", "INTERESTED", "NOT_INTERESTED", "MEETING_ARRANGED",
  "FINALIZED", "MARRIED", "REJECTED", "ARCHIVED",
];

const MARITAL_STATUS_OPTIONS = ["NEVER_MARRIED", "DIVORCED", "WIDOWED", "ANNULLED", "SEPARATED", "OTHER"];

export function FilterPanel({
  filters,
  onChange,
  onReset,
}: {
  filters: ProfileFilters;
  onChange: (filters: ProfileFilters) => void;
  onReset: () => void;
}) {
  function set<K extends keyof ProfileFilters>(key: K, value: ProfileFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Search" htmlFor="q">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input id="q" className="pl-9" placeholder="Name, Profile ID, phone..." value={filters.q} onChange={(e) => set("q", e.target.value)} />
          </div>
        </Field>
        <Field label="Gender" htmlFor="gender">
          <Select id="gender" value={filters.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Any</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="City" htmlFor="city">
          <Input id="city" value={filters.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Min Age" htmlFor="minAge">
          <Input id="minAge" type="number" value={filters.minAge} onChange={(e) => set("minAge", e.target.value)} />
        </Field>
        <Field label="Max Age" htmlFor="maxAge">
          <Input id="maxAge" type="number" value={filters.maxAge} onChange={(e) => set("maxAge", e.target.value)} />
        </Field>
        <Field label="Education" htmlFor="education">
          <Input id="education" value={filters.education} onChange={(e) => set("education", e.target.value)} />
        </Field>
        <Field label="Profession" htmlFor="profession">
          <Input id="profession" value={filters.profession} onChange={(e) => set("profession", e.target.value)} />
        </Field>
        <Field label="Marital Status" htmlFor="maritalStatus">
          <Select id="maritalStatus" value={filters.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
            <option value="">Any</option>
            {MARITAL_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Verification Status" htmlFor="verified">
          <Select id="verified" value={filters.verified} onChange={(e) => set("verified", e.target.value)}>
            <option value="">Any</option>
            <option value="true">Verified</option>
            <option value="false">Not Verified</option>
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={onReset}>
          Reset Filters
        </Button>
      </div>
    </div>
  );
}
