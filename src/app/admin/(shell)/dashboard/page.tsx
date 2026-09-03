"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Sparkles,
  ShieldCheck,
  UserRound,
  UserRoundCheck,
  Handshake,
  MessageCircleHeart,
  CalendarCheck2,
  Award,
  Archive,
  Loader2,
} from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { BarChart } from "@/components/admin/bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DashboardData {
  counts: Record<string, number>;
  byCity: { label: string; count: number }[];
  byEducation: { label: string; count: number }[];
  byProfession: { label: string; count: number }[];
  byAge: { label: string; count: number }[];
  monthlyRegistrations: { month: string; count: number }[];
  matchingSuccessRate: number;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const { counts } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">Overview of all matrimonial profiles and matchmaking activity.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Profiles" value={counts.total} />
        <StatCard icon={Sparkles} label="New Profiles" value={counts.new} accent="info" />
        <StatCard icon={ShieldCheck} label="Verified Profiles" value={counts.verified} accent="success" />
        <StatCard icon={UserRound} label="Male Profiles" value={counts.male} accent="muted" />
        <StatCard icon={UserRoundCheck} label="Female Profiles" value={counts.female} accent="muted" />
        <StatCard icon={UserRoundCheck} label="Active Profiles" value={counts.active} accent="success" />
        <StatCard icon={Handshake} label="Matching Profiles" value={counts.matching} />
        <StatCard icon={MessageCircleHeart} label="Proposals Sent" value={counts.proposalsSent} accent="warning" />
        <StatCard icon={MessageCircleHeart} label="Interested" value={counts.interested} accent="success" />
        <StatCard icon={CalendarCheck2} label="Meetings" value={counts.meetings} accent="info" />
        <StatCard icon={Award} label="Finalized Rishtas" value={counts.finalized} accent="success" />
        <StatCard icon={Archive} label="Archived Profiles" value={counts.archived} accent="muted" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profiles by Age</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.byAge} title="" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Profiles by City</CardTitle>
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
            <CardTitle>Monthly Registrations</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={data.monthlyRegistrations.map((m) => ({ label: m.month, count: m.count }))} title="" />
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
