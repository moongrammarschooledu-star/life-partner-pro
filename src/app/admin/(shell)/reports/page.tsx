"use client";

import { useEffect, useState } from "react";
import { Loader2, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart } from "@/components/admin/bar-chart";

interface DashboardData {
  byCity: { label: string; count: number }[];
  byEducation: { label: string; count: number }[];
  byProfession: { label: string; count: number }[];
  byAge: { label: string; count: number }[];
  monthlyRegistrations: { month: string; count: number }[];
}

interface ReportsData {
  conversionRate: number;
  totalProfiles: number;
  finalizedOrMarried: number;
  adminPerformance: { name: string; notes: number; communications: number }[];
  incomeDistribution: { label: string; count: number }[];
  matchingPerformance: {
    averageMatchScore: number;
    matchesGenerated: number;
    matchesReviewed: number;
    proposalsCreated: number;
    finalizedMatches: number;
    matchToProposalRate: number;
    proposalToMeetingRate: number;
    meetingToFinalizationRate: number;
  };
}

function downloadExport(type: string) {
  window.open(`/api/admin/reports/export?type=${type}`, "_blank");
}

export default function ReportsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [reports, setReports] = useState<ReportsData | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard").then((r) => r.json()).then(setDashboard);
    fetch("/api/admin/reports").then((r) => r.json()).then(setReports);
  }, []);

  if (!dashboard || !reports) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted">Registration, matching, and admin activity reports.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadExport("profiles")}>
            <Download className="h-4 w-4" /> Export Profiles (CSV)
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadExport("proposals")}>
            <Download className="h-4 w-4" /> Export Proposals (CSV)
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-3xl font-semibold text-primary">{reports.totalProfiles}</p>
            <p className="text-sm text-muted">Total Registrations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-3xl font-semibold text-success">{reports.finalizedOrMarried}</p>
            <p className="text-sm text-muted">Finalized Rishtas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-3xl font-semibold text-accent">{reports.conversionRate}%</p>
            <p className="text-sm text-muted">Conversion Rate</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Registrations</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={dashboard.monthlyRegistrations.map((m) => ({ label: m.month, count: m.count }))} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>City Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={dashboard.byCity} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Age Group Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={dashboard.byAge} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Income Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={reports.incomeDistribution} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Education Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={dashboard.byEducation} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Profession Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={dashboard.byProfession} title="" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Matching Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted">
            A compatibility score is a suggestion for admin review — it does not predict marriage success. These are activity and
            conversion metrics only.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Avg Match Score", value: `${reports.matchingPerformance.averageMatchScore}%` },
              { label: "Matches Generated", value: reports.matchingPerformance.matchesGenerated },
              { label: "Matches Reviewed", value: reports.matchingPerformance.matchesReviewed },
              { label: "Proposals Created", value: reports.matchingPerformance.proposalsCreated },
              { label: "Finalized Matches", value: reports.matchingPerformance.finalizedMatches },
              { label: "Match → Proposal Rate", value: `${reports.matchingPerformance.matchToProposalRate}%` },
              { label: "Proposal → Meeting Rate", value: `${reports.matchingPerformance.proposalToMeetingRate}%` },
              { label: "Meeting → Finalization Rate", value: `${reports.matchingPerformance.meetingToFinalizationRate}%` },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border p-3 text-center">
                <p className="text-xl font-semibold">{m.value}</p>
                <p className="mt-1 text-xs text-muted">{m.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admin Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {reports.adminPerformance.length === 0 ? (
            <p className="text-sm text-muted">No admin activity logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2">Admin</th>
                    <th className="py-2">Notes Added</th>
                    <th className="py-2">Communications Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.adminPerformance.map((p) => (
                    <tr key={p.name} className="border-b border-border last:border-0">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="py-2">{p.notes}</td>
                      <td className="py-2">{p.communications}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
