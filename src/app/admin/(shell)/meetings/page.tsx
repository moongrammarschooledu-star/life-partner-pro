"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, CalendarDays } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface MeetingItem {
  id: string;
  meetingType: string;
  scheduledAt: string;
  locationInfo: string | null;
  status: string;
  proposal: {
    id: string;
    proposalCode: string | null;
    profileA: { fullName: string; profileCode: string };
    profileB: { fullName: string; profileCode: string };
  };
}

export default function MeetingsPage() {
  const [data, setData] = useState<{ upcoming: MeetingItem[]; past: MeetingItem[] } | null>(null);
  const [tab, setTab] = useState("upcoming");

  useEffect(() => {
    fetch("/api/admin/meetings")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const items = tab === "upcoming" ? data.upcoming : data.past;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Meeting Management</h1>
        <p className="text-sm text-muted">All scheduled family/initial meetings across proposals. Schedule or update a meeting from its proposal page.</p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "upcoming", label: "Upcoming", count: data.upcoming.length },
          { value: "past", label: "Past / Cancelled", count: data.past.length },
        ]}
      />

      <Card>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No meetings here" />
          ) : (
            <div className="space-y-2">
              {items.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {formatEnumLabel(m.meetingType)} · {formatDateTime(m.scheduledAt)}
                    </p>
                    <p className="text-xs text-muted">
                      {m.proposal.profileA.fullName} &harr; {m.proposal.profileB.fullName}
                      {m.locationInfo ? ` · ${m.locationInfo}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={m.status} />
                    <Link href={`/admin/proposals/${m.proposal.id}`} className="text-xs font-medium text-primary hover:underline">
                      View Proposal
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
