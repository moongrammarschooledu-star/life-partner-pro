"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Activity } from "lucide-react";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";

interface ActivityItem {
  source: "audit" | "access";
  action: string;
  dataCategory: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;
const CATEGORIES = ["", "photo", "proposal", "meeting", "contact", "consent", "verification"];

export default function ActivityTimelinePage() {
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [data, setData] = useState<{ items: ActivityItem[]; total: number } | null>(null);

  useEffect(() => {
    setData(null);
    const params = new URLSearchParams({ page: String(page) });
    if (category) params.set("category", category);
    fetch(`/api/my-activity?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setData);
  }, [page, category]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Activity Timeline</h1>
          <p className="mt-1 text-sm text-muted">Everything recorded on your account — never another profile&apos;s details.</p>
        </div>
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-48">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c ? formatEnumLabel(c) : "All Categories"}</option>
          ))}
        </Select>
      </div>

      {data === null ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : data.items.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState icon={Activity} title="No activity recorded yet" /></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="space-y-2">
            {data.items.map((e, i) => (
              <div key={i} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                <span>{formatEnumLabel(e.action)}{e.dataCategory ? ` (${formatEnumLabel(e.dataCategory)})` : ""}</span>
                <span className="text-xs text-muted">{formatDateTime(e.createdAt)}</span>
              </div>
            ))}
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
