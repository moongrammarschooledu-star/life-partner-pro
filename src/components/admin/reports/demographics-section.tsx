"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { useRouter } from "next/navigation";

interface DemographicsData {
  total: number;
  gender: { label: string; count: number; percent: number }[];
  age: { label: string; count: number; percent: number; verified: number; active: number }[];
  city: { label: string; count: number }[];
  area: { label: string; count: number }[];
  education: { label: string; count: number; verified: number }[];
  profession: { label: string; count: number; verified: number }[];
}

// Spec §4/§5/§6/§7/§8 consolidated — every chart bar links to the
// pre-filtered profile list (spec §26 drill-down).
export function DemographicsSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const router = useRouter();
  const { data, loading, error } = useReportSection<DemographicsData>("/api/admin/reports/demographics", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.total === 0}>
      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart
              title="Gender Distribution"
              data={data.gender.map((g) => ({ label: g.label, count: g.count }))}
              onBarClick={(label) => router.push(`/admin/profiles?gender=${label}`)}
            />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Age Distribution" data={data.age.map((a) => ({ label: a.label, count: a.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart
              title="City Distribution"
              data={data.city}
              onBarClick={(label) => router.push(`/admin/profiles?city=${encodeURIComponent(label)}`)}
            />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Area Distribution" data={data.area} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Education Distribution" data={data.education.map((e) => ({ label: e.label, count: e.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Profession Distribution" data={data.profession.map((p) => ({ label: p.label, count: p.count }))} />
          </div>
        </div>
      )}
    </SectionShell>
  );
}
