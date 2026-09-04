"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, CalendarClock, Check, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatEnumLabel } from "@/lib/utils";

interface FollowUpItem {
  id: string;
  dueDate: string;
  title: string | null;
  note: string | null;
  purpose: string | null;
  outcome: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  profile: { id: string; profileCode: string; fullName: string };
  proposal: { id: string } | null;
  admin: { name: string } | null;
}

interface FollowUpsData {
  today: FollowUpItem[];
  upcoming: FollowUpItem[];
  overdue: FollowUpItem[];
  completed: FollowUpItem[];
  cancelled: FollowUpItem[];
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

function FollowUpRow({ item, onComplete, onCancel }: { item: FollowUpItem; onComplete?: () => void; onCancel?: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/profiles/${item.profile.id}`} className="font-medium text-primary hover:underline">
            {item.profile.fullName}
          </Link>
          <Badge variant={PRIORITY_VARIANT[item.priority]}>{formatEnumLabel(item.priority)}</Badge>
          {item.proposal && (
            <Link href={`/admin/proposals/${item.proposal.id}`} className="text-xs text-muted hover:underline">
              Proposal
            </Link>
          )}
        </div>
        <p className="text-xs text-muted">
          {item.profile.profileCode} · Due {formatDate(item.dueDate)}
          {item.admin ? ` · ${item.admin.name}` : ""}
        </p>
        {item.purpose && (
          <p className="mt-1 text-xs">
            <strong>Purpose:</strong> {item.purpose}
          </p>
        )}
        {(item.title || item.note) && <p className="mt-1 text-xs">{item.title ? <strong>{item.title}: </strong> : null}{item.note}</p>}
        {item.outcome && (
          <p className="mt-1 text-xs text-success">
            <strong>Outcome:</strong> {item.outcome}
          </p>
        )}
      </div>
      {(onComplete || onCancel) && (
        <div className="flex shrink-0 gap-2">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <Ban className="h-4 w-4" /> Cancel
            </Button>
          )}
          {onComplete && (
            <Button size="sm" variant="outline" onClick={onComplete}>
              <Check className="h-4 w-4" /> Complete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function FollowUpsPage() {
  const [data, setData] = useState<FollowUpsData | null>(null);
  const [tab, setTab] = useState("today");

  function load() {
    fetch("/api/admin/follow-ups")
      .then((r) => r.json())
      .then(setData);
  }

  useEffect(() => {
    load();
  }, []);

  async function markDone(id: string) {
    await fetch(`/api/admin/follow-ups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    load();
  }

  async function cancelFollowUp(id: string) {
    await fetch(`/api/admin/follow-ups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    load();
  }

  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const lists = data as unknown as Record<string, FollowUpItem[]>;
  const items = lists[tab] ?? [];
  const isActionable = tab === "today" || tab === "upcoming" || tab === "overdue";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Follow-up Center</h1>
        <p className="text-sm text-muted">Stay on top of scheduled check-ins with applicants.</p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "today", label: "Today", count: data.today.length },
          { value: "upcoming", label: "Upcoming", count: data.upcoming.length },
          { value: "overdue", label: "Overdue", count: data.overdue.length },
          { value: "completed", label: "Completed", count: data.completed.length },
          { value: "cancelled", label: "Cancelled", count: data.cancelled.length },
        ]}
      />

      <Card>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No follow-ups here" />
          ) : (
            <div className="space-y-2">
              {items.map((f) => (
                <FollowUpRow
                  key={f.id}
                  item={f}
                  onComplete={isActionable ? () => markDone(f.id) : undefined}
                  onCancel={isActionable ? () => cancelFollowUp(f.id) : undefined}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
