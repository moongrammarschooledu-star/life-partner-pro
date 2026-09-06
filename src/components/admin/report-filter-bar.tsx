"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export interface ReportFilterState {
  city: string;
  area: string;
  gender: string;
  minAge: string;
  maxAge: string;
  profession: string;
  education: string;
  maritalStatus: string;
  profileStatus: string;
  verificationStatus: string;
  staffId: string;
  proposalStatus: string;
}

export const EMPTY_REPORT_FILTERS: ReportFilterState = {
  city: "",
  area: "",
  gender: "",
  minAge: "",
  maxAge: "",
  profession: "",
  education: "",
  maritalStatus: "",
  profileStatus: "",
  verificationStatus: "",
  staffId: "",
  proposalStatus: "",
};

const PROFILE_STATUSES = [
  "NEW", "UNDER_REVIEW", "VERIFIED", "ACTIVE", "MATCHING", "PROPOSAL_SENT", "WAITING_FOR_RESPONSE",
  "INTERESTED", "NOT_INTERESTED", "MEETING_ARRANGED", "FINALIZED", "MARRIED", "REJECTED", "ARCHIVED", "SUSPENDED",
];
const VERIFICATION_STATUSES = [
  "NOT_VERIFIED", "VERIFICATION_PENDING", "UNDER_REVIEW", "VERIFICATION_REQUIRED",
  "VERIFIED", "VERIFICATION_REJECTED", "VERIFICATION_EXPIRED", "RE_VERIFICATION_REQUIRED",
];
const PROPOSAL_STATUSES = [
  "PROPOSAL_CREATED", "WAITING_FOR_PROFILE_A", "WAITING_FOR_PROFILE_B", "BOTH_REVIEWING",
  "BOTH_INTERESTED", "CONTACT_PERMISSION_PENDING", "CONTACT_APPROVED", "FAMILIES_CONTACTED",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "ACCEPTED", "REJECTED", "ON_HOLD", "FINALIZED", "MARRIED", "ARCHIVED",
];
const MARITAL_STATUSES = ["NEVER_MARRIED", "DIVORCED", "WIDOWED", "ANNULLED", "SEPARATED", "OTHER"];

function labelize(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Spec §1's 11-filter vocabulary. Deliberately a new component rather than
// generalizing the existing page-specific FilterPanel (src/components/admin/filter-panel.tsx),
// which is narrower and used by the working Profiles page.
export function ReportFilterBar({
  filters,
  onChange,
  onReset,
  adminOptions,
}: {
  filters: ReportFilterState;
  onChange: (filters: ReportFilterState) => void;
  onReset: () => void;
  adminOptions: { id: string; name: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const set = (key: keyof ReportFilterState, value: string) => onChange({ ...filters, [key]: value });
  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-sm font-medium md:hidden"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" /> Filters {activeCount > 0 && `(${activeCount})`}
        </span>
      </button>
      <div className={`${expanded ? "mt-4 grid" : "hidden md:grid"} grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}>
        <Field label="City">
          <Input value={filters.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g. Lahore" />
        </Field>
        <Field label="Area">
          <Input value={filters.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. DHA" />
        </Field>
        <Field label="Gender">
          <Select value={filters.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Any</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
          </Select>
        </Field>
        <Field label="Marital Status">
          <Select value={filters.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)}>
            <option value="">Any</option>
            {MARITAL_STATUSES.map((s) => (
              <option key={s} value={s}>{labelize(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Min Age">
          <Input type="number" min={18} value={filters.minAge} onChange={(e) => set("minAge", e.target.value)} />
        </Field>
        <Field label="Max Age">
          <Input type="number" min={18} value={filters.maxAge} onChange={(e) => set("maxAge", e.target.value)} />
        </Field>
        <Field label="Profession">
          <Input value={filters.profession} onChange={(e) => set("profession", e.target.value)} placeholder="e.g. Engineer" />
        </Field>
        <Field label="Education">
          <Input value={filters.education} onChange={(e) => set("education", e.target.value)} placeholder="e.g. Bachelors" />
        </Field>
        <Field label="Profile Status">
          <Select value={filters.profileStatus} onChange={(e) => set("profileStatus", e.target.value)}>
            <option value="">Any</option>
            {PROFILE_STATUSES.map((s) => (
              <option key={s} value={s}>{labelize(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Verification Status">
          <Select value={filters.verificationStatus} onChange={(e) => set("verificationStatus", e.target.value)}>
            <option value="">Any</option>
            {VERIFICATION_STATUSES.map((s) => (
              <option key={s} value={s}>{labelize(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Proposal Status">
          <Select value={filters.proposalStatus} onChange={(e) => set("proposalStatus", e.target.value)}>
            <option value="">Any</option>
            {PROPOSAL_STATUSES.map((s) => (
              <option key={s} value={s}>{labelize(s)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Staff / Admin">
          <Select value={filters.staffId} onChange={(e) => set("staffId", e.target.value)}>
            <option value="">Any</option>
            {adminOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      {activeCount > 0 && (
        <div className={`${expanded ? "" : "hidden md:flex"} mt-3 flex justify-end`}>
          <Button variant="outline" size="sm" onClick={onReset}>
            <X className="h-3.5 w-3.5" /> Clear Filters
          </Button>
        </div>
      )}
    </div>
  );
}
