"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, CalendarClock, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

interface FollowUpItem {
  id: string;
  dueDate: string;
  note: string | null;
  profile: { id: string; profileCode: string; fullName: string };
}

interface FollowUpsData {
  today: FollowUpItem[];
  upcoming: FollowUpItem[];
  overdue: FollowUpItem[];
}

function Section({ title, items, onDone }: { title: string; items: FollowUpItem[]; onDone: (id: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted">Nothing here.</p>
        ) : (
          <div className="space-y-2">
            {items.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0">
                  <Link href={`/admin/profiles/${f.profile.id}`} className="font-medium text-primary hover:underline">
                    {f.profile.fullName}
                  </Link>
                  <p className="text-xs text-muted">
                    {f.profile.profileCode} &middot; Due {formatDate(f.dueDate)}
                  </p>
                  {f.note && <p className="mt-1 text-xs">{f.note}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={() => onDone(f.id)}>
                  <Check className="h-4 w-4" /> Done
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FollowUpsPage() {
  const [data, setData] = useState<FollowUpsData | null>(null);

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Follow-ups</h1>
        <p className="text-sm text-muted">Stay on top of scheduled check-ins with applicants.</p>
      </div>

      {!data ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : data.today.length + data.upcoming.length + data.overdue.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No follow-ups scheduled" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Section title="Overdue" items={data.overdue} onDone={markDone} />
          <Section title="Today's Follow-ups" items={data.today} onDone={markDone} />
          <Section title="Upcoming Follow-ups" items={data.upcoming} onDone={markDone} />
        </div>
      )}
    </div>
  );
}
