"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Sparkles,
  ShieldCheck,
  UserRoundCheck,
  ClipboardList,
  MessageCircleHeart,
  CalendarCheck2,
  Award,
  ArrowRight,
} from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { BarChart } from "@/components/admin/bar-chart";
import { RegistrationTrendChart, type TrendPoint } from "@/components/admin/registration-trend-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";

interface DashboardData {
  counts: Record<string, number>;
  trends: Record<string, number | null>;
  byCity: { label: string; count: number }[];
  byEducation: { label: string; count: number }[];
  byProfession: { label: string; count: number }[];
  byAge: { label: string; count: number }[];
  byGender: { label: string; count: number }[];
  monthlyRegistrations: { month: string; count: number }[];
  registrationTrend: TrendPoint[];
  matchingSuccessRate: number;
  matchingOverview: {
    potentialMatches: number;
    highCompatibilityMatches: number;
    proposalsPending: number;
    interested: number;
    meetingsScheduled: number;
    finalized: number;
  };
  priorities: {
    profilesAwaitingVerification: number;
    followUpsDueToday: number;
    newHighCompatMatches: number;
    recentProposalResponses: number;
  };
  todaysBestMatches: {
    id: string;
    profileACode: string;
    profileAName: string;
    profileBCode: string;
    profileBName: string;
    score: number;
    status: string;
  }[];
  proposalKpis: {
    total: number;
    pendingResponses: number;
    mutualInterest: number;
    contactPending: number;
    meetingsScheduled: number;
    meetingsCompleted: number;
    accepted: number;
    finalized: number;
    married: number;
    rejected: number;
  };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [period, setPeriod] = useState("6m");

  useEffect(() => {
    fetch(`/api/admin/dashboard?period=${period}`)
      .then((r) => r.json())
      .then(setData);
  }, [period]);

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { counts, trends } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{greeting()}, Admin</h1>
        <p className="text-sm text-muted">Here is today&apos;s matchmaking activity. · {today}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Profiles" value={counts.total} trendPercent={trends.total} />
        <StatCard icon={Sparkles} label="New Profiles" value={counts.new} accent="info" trendPercent={trends.new} />
        <StatCard icon={ShieldCheck} label="Verified Profiles" value={counts.verified} accent="success" trendPercent={trends.verified} />
        <StatCard icon={UserRoundCheck} label="Active Profiles" value={counts.active} accent="success" />
        <StatCard icon={ClipboardList} label="Pending Review" value={counts.pendingReview} accent="warning" />
        <StatCard icon={MessageCircleHeart} label="Active Proposals" value={counts.activeProposals} accent="info" />
        <StatCard icon={CalendarCheck2} label="Meetings" value={counts.meetings} accent="info" />
        <StatCard icon={Award} label="Successful Matches" value={counts.successfulMatches} accent="success" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Registrations</CardTitle>
        </CardHeader>
        <CardContent>
          <RegistrationTrendChart data={data.registrationTrend} period={period} onPeriodChange={setPeriod} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Matching Center Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Potential Matches", value: data.matchingOverview.potentialMatches },
              { label: "High Compatibility", value: data.matchingOverview.highCompatibilityMatches },
              { label: "Proposals Pending", value: data.matchingOverview.proposalsPending },
              { label: "Interested", value: data.matchingOverview.interested },
              { label: "Meetings Scheduled", value: data.matchingOverview.meetingsScheduled },
              { label: "Finalized", value: data.matchingOverview.finalized },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border border-border p-3 text-center">
                <p className="text-xl font-semibold">{m.value}</p>
                <p className="mt-1 text-xs text-muted">{m.label}</p>
              </div>
            ))}
          </div>
          <Link href="/admin/matching" className={buttonClass({ className: "mt-4" })}>
            Open Matching Center <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Best Matches</CardTitle>
        </CardHeader>
        <CardContent>
          {data.todaysBestMatches.length === 0 ? (
            <EmptyState icon={Sparkles} title="No matches generated today yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">Profile A</th>
                    <th className="py-2 pr-3">Profile B</th>
                    <th className="py-2 pr-3">Score</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.todaysBestMatches.map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3">
                        {m.profileAName} <span className="text-muted">({m.profileACode})</span>
                      </td>
                      <td className="py-2 pr-3">
                        {m.profileBName} <span className="text-muted">({m.profileBCode})</span>
                      </td>
                      <td className="py-2 pr-3 font-medium">{m.score}%</td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={m.status} />
                      </td>
                      <td className="py-2">
                        <Link href={`/admin/matches/${m.id}`} className="font-medium text-primary hover:underline">
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircleHeart className="h-4 w-4 text-primary" /> Rishta Proposal Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "Total Proposals", value: data.proposalKpis.total },
              { label: "Pending Responses", value: data.proposalKpis.pendingResponses },
              { label: "Mutual Interest", value: data.proposalKpis.mutualInterest },
              { label: "Contact Pending", value: data.proposalKpis.contactPending },
              { label: "Meetings Scheduled", value: data.proposalKpis.meetingsScheduled },
              { label: "Meetings Completed", value: data.proposalKpis.meetingsCompleted },
              { label: "Accepted", value: data.proposalKpis.accepted },
              { label: "Finalized", value: data.proposalKpis.finalized },
              { label: "Married", value: data.proposalKpis.married },
              { label: "Rejected", value: data.proposalKpis.rejected },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-border p-3 text-center">
                <p className="text-xl font-semibold">{k.value}</p>
                <p className="mt-1 text-xs text-muted">{k.label}</p>
              </div>
            ))}
          </div>
          <Link href="/admin/proposals" className={buttonClass({ variant: "outline", className: "mt-4" })}>
            Open Proposals <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Priorities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            {
              show: data.priorities.profilesAwaitingVerification > 0,
              text: `${data.priorities.profilesAwaitingVerification} Profiles Awaiting Verification`,
              action: "Review Now",
              href: "/admin/profiles?status=UNDER_REVIEW",
            },
            {
              show: data.priorities.followUpsDueToday > 0,
              text: `${data.priorities.followUpsDueToday} Follow-ups Due Today`,
              action: "View Follow-ups",
              href: "/admin/follow-ups",
            },
            {
              show: data.priorities.newHighCompatMatches > 0,
              text: `${data.priorities.newHighCompatMatches} New High-Compatibility Matches`,
              action: "Review Matches",
              href: "/admin/matching",
            },
            {
              show: data.priorities.recentProposalResponses > 0,
              text: `${data.priorities.recentProposalResponses} Proposal Responses`,
              action: "View Responses",
              href: "/admin/proposals",
            },
          ]
            .filter((p) => p.show)
            .map((p) => (
              <div key={p.text} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <span>{p.text}</span>
                <Link href={p.href} className={buttonClass({ variant: "outline", size: "sm" })}>
                  {p.action}
                </Link>
              </div>
            ))}
          {![
            data.priorities.profilesAwaitingVerification,
            data.priorities.followUpsDueToday,
            data.priorities.newHighCompatMatches,
            data.priorities.recentProposalResponses,
          ].some(Boolean) && <p className="text-sm text-muted">Nothing needs your attention right now.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gender Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.byGender} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Age Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.byAge} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>City Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.byCity} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Profession Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.byProfession} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Education Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.byEducation} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Matching Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <p className="text-4xl font-semibold text-primary">{data.matchingSuccessRate}%</p>
              <p className="text-sm text-muted">of created proposals have reached Finalized status.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
