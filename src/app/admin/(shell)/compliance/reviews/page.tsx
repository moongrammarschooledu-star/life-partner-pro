"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";

interface ReviewItem {
  id: string;
  reviewCode: string;
  subjectType: string;
  subjectId: string;
  status: string;
  reviewType: string | null;
  notes: string | null;
  dueDate: string | null;
  createdAt: string;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Month-grid calendar view (spec: a calendar, not only a due-list). Items
// with no dueDate never appear here — they still show in the List tab.
function ReviewsCalendar({ items }: { items: ReviewItem[] }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const itemsByDay = useMemo(() => {
    const map = new Map<string, ReviewItem[]>();
    for (const item of items) {
      if (!item.dueDate) continue;
      const key = item.dueDate.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ day: d, key });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Button size="sm" variant="outline" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="font-medium">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
        <Button size="sm" variant="outline" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium uppercase text-muted">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="p-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} className="min-h-20 rounded-lg" />;
          const dayItems = itemsByDay.get(cell.key) ?? [];
          const isToday = cell.key === todayKey;
          return (
            <div key={cell.key} className={`min-h-20 rounded-lg border p-1 text-left ${isToday ? "border-primary" : "border-border"}`}>
              <p className={`text-xs ${isToday ? "font-semibold text-primary" : "text-muted"}`}>{cell.day}</p>
              <div className="mt-1 space-y-0.5">
                {dayItems.slice(0, 3).map((item) => (
                  <div key={item.id} className="truncate rounded bg-warning/10 px-1 py-0.5 text-[10px] text-warning" title={`${item.reviewCode} — ${item.subjectType}`}>
                    {item.reviewCode}
                  </div>
                ))}
                {dayItems.length > 3 && <p className="text-[10px] text-muted">+{dayItems.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewsList({ items }: { items: ReviewItem[] }) {
  if (items.length === 0) return <EmptyState icon={ClipboardCheck} title="No open reviews" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Code</th>
            <th className="p-3">Subject</th>
            <th className="p-3">Type</th>
            <th className="p-3">Status</th>
            <th className="p-3">Due</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="p-3 font-mono text-xs">{r.reviewCode}</td>
              <td className="p-3 text-muted">
                {r.subjectType} · <span className="font-mono">{r.subjectId}</span>
              </td>
              <td className="p-3">{r.reviewType ?? "—"}</td>
              <td className="p-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="p-3 text-muted">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ComplianceReviewsPage() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [view, setView] = useState("list");

  useEffect(() => {
    fetch("/api/admin/compliance/reviews")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Compliance Reviews</h1>
        <p className="text-sm text-muted">Every open review across rules, processors, transfers and orders.</p>
      </div>

      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: "list", label: "List" },
          { value: "calendar", label: "Calendar" },
        ]}
      />

      <Card>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : view === "calendar" ? (
            <ReviewsCalendar items={items} />
          ) : (
            <ReviewsList items={items} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
