"use client";

import Link from "next/link";
import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";

interface CompletenessData {
  summary: { total: number; average: number | null; buckets: { above90: number; from70to89: number; from50to69: number; below50: number } };
  incomplete?: { items: { id: string; profileCode: string; fullName: string; city: string; profileCompletion: number }[] };
}

// Spec §11 — "Incomplete Profiles Report" for follow-up targeting.
export function CompletenessSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<CompletenessData>(
    "/api/admin/reports/completeness",
    `${queryString}&incomplete=true`,
    enabled
  );

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data || data.summary.total === 0}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-muted">Average Completeness</p>
              <p className="mt-1 text-2xl font-semibold">{data.summary.average != null ? `${data.summary.average}%` : "—"}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart
              title="Completeness Buckets"
              data={[
                { label: "90%+", count: data.summary.buckets.above90 },
                { label: "70–89%", count: data.summary.buckets.from70to89 },
                { label: "50–69%", count: data.summary.buckets.from50to69 },
                { label: "Below 50%", count: data.summary.buckets.below50 },
              ]}
            />
          </div>
          {data.incomplete && data.incomplete.items.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-3 text-sm font-medium">Profiles Needing Follow-Up (below 70%)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="pb-2">Profile</th>
                      <th className="pb-2">City</th>
                      <th className="pb-2 text-right">Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.incomplete.items.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="py-2">
                          <Link href={`/admin/profiles/${p.id}`} className="text-primary hover:underline">
                            {p.fullName} ({p.profileCode})
                          </Link>
                        </td>
                        <td className="py-2 text-muted">{p.city}</td>
                        <td className="py-2 text-right font-medium">{p.profileCompletion}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </SectionShell>
  );
}
