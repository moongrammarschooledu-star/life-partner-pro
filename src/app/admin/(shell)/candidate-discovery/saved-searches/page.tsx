"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, BookmarkCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface SavedSearchRow {
  id: string;
  searchCode: string;
  name: string;
  description: string | null;
  visibility: string;
  updatedAt: string;
}

export default function SavedSearchesPage() {
  const [items, setItems] = useState<SavedSearchRow[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/search/presets")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }, []);

  return (
    <div className="space-y-4">
      <Link href="/admin/candidate-discovery" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Candidate Discovery
      </Link>
      <h1 className="font-heading text-2xl font-semibold">Saved Searches</h1>
      <p className="text-sm text-muted">Reusable filter presets — private, team, department, or organization-wide.</p>

      {items === null ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={BookmarkCheck} title="No saved searches yet" description="Save a filter from Candidate Discovery's advanced filters panel." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Name</th>
                <th className="p-3">Visibility</th>
                <th className="p-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    <p className="font-medium">{s.name}</p>
                    {s.description && <p className="text-xs text-muted">{s.description}</p>}
                  </td>
                  <td className="p-3"><Badge variant="muted">{formatEnumLabel(s.visibility)}</Badge></td>
                  <td className="p-3 text-muted">{formatDateTime(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
