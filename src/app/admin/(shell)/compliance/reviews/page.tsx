"use client";

import { useEffect, useState } from "react";
import { Loader2, ClipboardCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
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

// Due-list, not a calendar-grid UI (plan decision 14) — every polymorphic
// ComplianceReview row still open, oldest-due first.
export default function ComplianceReviewsPage() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/compliance/reviews")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Compliance Reviews</h1>
        <p className="text-sm text-muted">Every open review across rules, processors, transfers and orders — sorted by due date.</p>
      </div>

      <Card>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No open reviews" />
          ) : (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
