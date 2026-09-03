"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface AuditItem {
  id: string;
  action: string;
  createdAt: string;
  admin: { name: string } | null;
  targetProfile: { id: string; profileCode: string; fullName: string } | null;
}

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch(`/api/admin/audit-log?page=${page}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setTotalPages(data.totalPages ?? 1);
      });
  }, [page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted">A full trail of sensitive admin actions — logins, edits, contact reveals, and matching activity.</p>
      </div>

      {items === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit events yet" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="p-3">Admin</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Profile</th>
                  <th className="p-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="p-3">{item.admin?.name ?? "System"}</td>
                    <td className="p-3">{formatEnumLabel(item.action)}</td>
                    <td className="p-3">
                      {item.targetProfile ? (
                        <Link href={`/admin/profiles/${item.targetProfile.id}`} className="text-primary hover:underline">
                          {item.targetProfile.fullName} ({item.targetProfile.profileCode})
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 text-muted">{formatDateTime(item.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
