"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface HistoryRow {
  id: string;
  searchType: string;
  filterSummary: Record<string, unknown>;
  resultCount: number;
  createdAt: string;
}

export default function SearchHistoryPage() {
  const [items, setItems] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/search/recent")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div className="space-y-4">
      <Link href="/admin/candidate-discovery" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Candidate Discovery
      </Link>
      <h1 className="font-heading text-2xl font-semibold">Recent Searches</h1>

      {items === null ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={History} title="No searches yet" description="Your recent candidate searches will appear here." />
      ) : (
        <div className="space-y-2">
          {items.map((h) => (
            <div key={h.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
              <div className="flex items-center justify-between">
                <Badge variant="muted">{formatEnumLabel(h.searchType)}</Badge>
                <span className="text-xs text-muted">{formatDateTime(h.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{JSON.stringify(h.filterSummary)}</p>
              <p className="mt-1 text-xs">{h.resultCount} result(s)</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
