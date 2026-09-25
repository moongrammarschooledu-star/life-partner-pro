"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck, ShieldQuestion, Heart, Bell, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatEnumLabel } from "@/lib/utils";

interface Dashboard {
  me: { fullName: string; relationship: string; role: string } | null;
  applicant: { profileCode: string; status: string; profileCompletion: number; verified: boolean } | null;
  proposalCount: number;
  pendingFamilyDecisions: number;
  upcomingMeetings: { id: string; scheduledAt: string; meetingType: string }[];
  unreadNotifications: number;
  permissions: string[];
}

export default function FamilyDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);

  useEffect(() => {
    fetch("/api/family/dashboard").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Welcome, {data.me?.fullName}</h1>
        <p className="text-sm text-muted">
          You are assisting {data.applicant ? data.applicant.profileCode : "an applicant"} through Life Partner Pro, as their {data.me?.relationship?.toLowerCase()}.
          You do not own this account — access can be adjusted or revoked by the applicant at any time.
        </p>
      </div>

      {!data.applicant && (
        <Card><CardContent className="py-6 text-sm text-muted">You don&apos;t currently have permission to view the applicant&apos;s profile. Ask them to grant access from their dashboard.</CardContent></Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data.applicant && (
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              {data.applicant.verified ? <ShieldCheck className="h-6 w-6 text-success" /> : <ShieldQuestion className="h-6 w-6 text-warning" />}
              <div>
                <p className="text-xs text-muted">Profile Status</p>
                <p className="font-medium">{formatEnumLabel(data.applicant.status)}</p>
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Heart className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted">Shared Proposals</p>
              <p className="font-medium">{data.proposalCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Bell className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted">Unread Notifications</p>
              <p className="font-medium">{data.unreadNotifications}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Calendar className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted">Upcoming Meetings</p>
              <p className="font-medium">{data.upcomingMeetings.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {data.pendingFamilyDecisions > 0 && (
        <Card>
          <CardContent className="py-4 text-sm">
            You have {data.pendingFamilyDecisions} proposal(s) where you can suggest a response. <Link href="/family/proposals" className="text-primary hover:underline">View proposals</Link>.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
