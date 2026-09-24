"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck, ShieldQuestion, Heart, Bell, Calendar, FileEdit, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";

interface Summary {
  status: { profileCode: string; status: string; verified: boolean; profileCompletion: number; createdAt: string };
  totalProposals: number;
  proposalsByStatus: { status: string; count: number }[];
  upcomingMeetings: { id: string; scheduledAt: string; meetingType: string; status: string }[];
  unreadNotifications: number;
  pendingPrivacyRequests: number;
  hasPendingUpdate: boolean;
  pendingUpdateSubmittedAt: string | null;
}

const SPOKES = [
  { href: "/dashboard/profile", label: "My Profile", desc: "View and manage your profile details" },
  { href: "/dashboard/profile/partner-requirements", label: "Partner Requirements", desc: "Update who you're looking for" },
  { href: "/dashboard/profile/photos", label: "Photos", desc: "Manage your profile photos" },
  { href: "/my-verification", label: "Verification Center", desc: "Mobile/email verification, documents" },
  { href: "/my-proposals", label: "Proposal Center", desc: "View and respond to proposals" },
  { href: "/dashboard/family", label: "Family Interaction", desc: "Family outreach history and requests" },
  { href: "/my-notifications", label: "Notification Center", desc: "Updates and preferences" },
  { href: "/my-privacy", label: "Privacy Dashboard", desc: "Your data, consent, and requests" },
  { href: "/account-settings", label: "Account & Security", desc: "Sessions, deactivation, deletion" },
  { href: "/my-billing", label: "Payment Center", desc: "Packages, subscription, invoices" },
  { href: "/my-cases", label: "Support Center", desc: "Help requests and complaints" },
  { href: "/dashboard/activity", label: "Activity Timeline", desc: "Everything that's happened on your account" },
  { href: "/dashboard/ai-assistant", label: "Profile Assistant", desc: "AI-assisted profile improvement suggestions" },
];

export default function DashboardHomePage() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/my-dashboard/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setSummary);
  }, []);

  if (!summary) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Welcome back, {summary.status.profileCode}</h1>
        <p className="text-sm text-muted">Everything about your Life Partner Pro account, in one place.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            {summary.status.verified ? <ShieldCheck className="h-6 w-6 text-success" /> : <ShieldQuestion className="h-6 w-6 text-warning" />}
            <div>
              <p className="text-xs text-muted">Status</p>
              <p className="font-medium">{formatEnumLabel(summary.status.status)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <FileEdit className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted">Profile Completion</p>
              <p className="font-medium">{summary.status.profileCompletion}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Heart className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted">Proposals</p>
              <p className="font-medium">{summary.totalProposals}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <Bell className="h-6 w-6 text-primary" />
            <div>
              <p className="text-xs text-muted">Unread Notifications</p>
              <p className="font-medium">{summary.unreadNotifications}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {(summary.hasPendingUpdate || summary.pendingPrivacyRequests > 0 || summary.upcomingMeetings.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Needs Your Attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.hasPendingUpdate && (
              <div className="flex items-center justify-between text-sm">
                <span>A profile update request is awaiting admin review.</span>
                <Badge variant="muted">Pending</Badge>
              </div>
            )}
            {summary.pendingPrivacyRequests > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span>{summary.pendingPrivacyRequests} privacy request(s) in progress.</span>
                <Link href="/my-privacy" className="text-primary hover:underline">View</Link>
              </div>
            )}
            {summary.upcomingMeetings.map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> {formatEnumLabel(m.meetingType)} — {formatDateTime(m.scheduledAt)}
                </span>
                <Badge variant="muted">{formatEnumLabel(m.status)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="mb-3 font-heading text-lg font-semibold">Explore</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SPOKES.map((s) => (
            <Link key={s.href} href={s.href}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardContent className="flex items-start justify-between gap-2 py-4">
                  <div>
                    <p className="font-medium">{s.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{s.desc}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
