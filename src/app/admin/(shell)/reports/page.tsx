"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet, History, CalendarClock } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { buttonClass } from "@/components/ui/button";
import { ReportFilterBar, EMPTY_REPORT_FILTERS, type ReportFilterState } from "@/components/admin/report-filter-bar";
import { DateRangePicker } from "@/components/admin/date-range-picker";
import type { DateRangePreset } from "@/lib/reports/types";
import { OverviewSection } from "@/components/admin/reports/overview-section";
import { RegistrationSection } from "@/components/admin/reports/registration-section";
import { DemographicsSection } from "@/components/admin/reports/demographics-section";
import { IncomeSection } from "@/components/admin/reports/income-section";
import { VerificationSection } from "@/components/admin/reports/verification-section";
import { CompletenessSection } from "@/components/admin/reports/completeness-section";
import { MatchingSection } from "@/components/admin/reports/matching-section";
import { ProposalsSection } from "@/components/admin/reports/proposals-section";
import { MeetingsSection } from "@/components/admin/reports/meetings-section";
import { OutcomesFunnelSection } from "@/components/admin/reports/outcomes-funnel-section";
import { StaffPerformanceSection } from "@/components/admin/reports/staff-performance-section";
import { CommunicationsSection } from "@/components/admin/reports/communications-section";
import { FollowupsSection } from "@/components/admin/reports/followups-section";

type Tab =
  | "overview" | "registration" | "demographics" | "income" | "verification" | "completeness"
  | "matching" | "proposals" | "meetings" | "outcomes" | "staff" | "communications" | "followups";

const ALL_TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "registration", label: "Registration" },
  { value: "demographics", label: "Demographics" },
  { value: "income", label: "Income" },
  { value: "verification", label: "Verification" },
  { value: "completeness", label: "Completeness" },
  { value: "matching", label: "Matching" },
  { value: "proposals", label: "Proposals" },
  { value: "meetings", label: "Meetings" },
  { value: "outcomes", label: "Outcomes & Funnel" },
  { value: "staff", label: "Staff Performance" },
  { value: "communications", label: "Communications" },
  { value: "followups", label: "Follow-Ups" },
];

export default function ReportsPage() {
  const [role, setRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [visited, setVisited] = useState<Set<Tab>>(new Set(["overview"]));
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_REPORT_FILTERS);
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [admins, setAdmins] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setRole(s?.user?.role ?? null))
      .catch(() => setRole(null));
    fetch("/api/admin/reports/admins")
      .then((r) => r.json())
      .then((j) => setAdmins(j.items ?? []))
      .catch(() => {});
  }, []);

  function selectTab(next: string) {
    const t = next as Tab;
    setTab(t);
    setVisited((prev) => new Set(prev).add(t));
  }

  function handleDateChange(nextPreset: DateRangePreset, from: string, to: string) {
    setPreset(nextPreset);
    setCustomFrom(from);
    setCustomTo(to);
  }

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("preset", preset);
    if (preset === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    return params.toString();
  }, [filters, preset, customFrom, customTo]);

  const visibleTabs = ALL_TABS.filter((t) => {
    if (t.value === "income") return role === "SUPER_ADMIN" || role === "ADMIN";
    if (t.value === "staff") return role === "SUPER_ADMIN";
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Reports & Analytics</h1>
          <p className="text-sm text-muted">Real-time, filterable analytics across every part of the platform.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/reports/custom" className={buttonClass({ variant: "outline", size: "sm" })}>
            <FileSpreadsheet className="h-4 w-4" /> Custom Report
          </Link>
          <Link href="/admin/reports/history" className={buttonClass({ variant: "outline", size: "sm" })}>
            <History className="h-4 w-4" /> History
          </Link>
          {role === "SUPER_ADMIN" && (
            <Link href="/admin/reports/scheduled" className={buttonClass({ variant: "outline", size: "sm" })}>
              <CalendarClock className="h-4 w-4" /> Scheduled Reports
            </Link>
          )}
        </div>
      </div>

      <DateRangePicker preset={preset} from={customFrom} to={customTo} onChange={handleDateChange} />
      <ReportFilterBar filters={filters} onChange={setFilters} onReset={() => setFilters(EMPTY_REPORT_FILTERS)} adminOptions={admins} />

      <Tabs tabs={visibleTabs} value={tab} onChange={selectTab} />

      <div>
        {tab === "overview" && <OverviewSection queryString={queryString} enabled={visited.has("overview")} />}
        {tab === "registration" && <RegistrationSection queryString={queryString} enabled={visited.has("registration")} />}
        {tab === "demographics" && <DemographicsSection queryString={queryString} enabled={visited.has("demographics")} />}
        {tab === "income" && <IncomeSection queryString={queryString} enabled={visited.has("income")} />}
        {tab === "verification" && <VerificationSection queryString={queryString} enabled={visited.has("verification")} />}
        {tab === "completeness" && <CompletenessSection queryString={queryString} enabled={visited.has("completeness")} />}
        {tab === "matching" && <MatchingSection queryString={queryString} enabled={visited.has("matching")} />}
        {tab === "proposals" && <ProposalsSection queryString={queryString} enabled={visited.has("proposals")} />}
        {tab === "meetings" && <MeetingsSection queryString={queryString} enabled={visited.has("meetings")} />}
        {tab === "outcomes" && <OutcomesFunnelSection queryString={queryString} enabled={visited.has("outcomes")} />}
        {tab === "staff" && <StaffPerformanceSection queryString={queryString} enabled={visited.has("staff")} />}
        {tab === "communications" && <CommunicationsSection queryString={queryString} enabled={visited.has("communications")} />}
        {tab === "followups" && <FollowupsSection queryString={queryString} enabled={visited.has("followups")} />}
      </div>
    </div>
  );
}
