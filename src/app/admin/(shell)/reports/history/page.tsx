"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { buttonClass, Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";

interface ReportExecutionRow {
  id: string;
  name: string;
  reportKey: string;
  dataSource: string | null;
  exportType: string | null;
  recordCount: number;
  createdAt: string;
  createdBy: { name: string };
}

// Spec §24 — Report History.
export default function ReportHistoryPage() {
  const { show } = useToast();
  const [items, setItems] = useState<ReportExecutionRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    fetch(`/api/admin/reports/history?page=${page}`)
      .then((r) => r.json())
      .then((j) => {
        setItems(j.items);
        setTotalPages(j.totalPages);
      });
  }, [page]);

  async function regenerate(id: string) {
    setRegeneratingId(id);
    try {
      const res = await fetch(`/api/admin/reports/history/${id}/regenerate`, { method: "POST" });
      if (!res.ok) throw new Error();
      show("Report regenerated — open Custom Report to view fresh results.", "success");
    } catch {
      show("Could not regenerate this report.", "error");
    } finally {
      setRegeneratingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className={buttonClass({ variant: "outline", size: "sm" })}>
          <ArrowLeft className="h-4 w-4" /> Back to Reports
        </Link>
        <div>
          <h1 className="font-heading text-2xl font-semibold">Report History</h1>
          <p className="text-sm text-muted">Every report generated or exported, with its filters and record count.</p>
        </div>
      </div>

      {!items ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="No reports generated yet" description="Reports appear here once generated from Overview, Custom Report, or an export." />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Created By</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Export Type</th>
                  <th className="pb-2 text-right">Records</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-muted">{r.createdBy.name}</td>
                    <td className="py-2 text-muted">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="py-2 text-muted">{r.exportType ?? "View only"}</td>
                    <td className="py-2 text-right">{r.recordCount}</td>
                    <td className="py-2 text-right">
                      {r.dataSource && (
                        <Button variant="outline" size="sm" onClick={() => regenerate(r.id)} disabled={regeneratingId === r.id}>
                          <RotateCcw className="h-3.5 w-3.5" /> Regenerate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
