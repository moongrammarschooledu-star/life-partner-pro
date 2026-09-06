export type DateRangePreset = "today" | "yesterday" | "7d" | "30d" | "90d" | "thisYear" | "custom";

export interface ResolvedDateRange {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
}

// The 11-filter vocabulary from spec §1, shared by every Reports section
// route and the Custom Report Builder.
export interface ReportFilters {
  city?: string;
  area?: string;
  gender?: string;
  minAge?: number;
  maxAge?: number;
  profession?: string;
  education?: string;
  maritalStatus?: string;
  profileStatus?: string;
  verificationStatus?: string;
  staffId?: string;
  proposalStatus?: string;
  dateRange: ResolvedDateRange;
}

export interface KpiResult {
  value: number;
  previousValue: number | null;
  percentChange: number | null;
  trend: "up" | "down" | "flat" | null;
}
