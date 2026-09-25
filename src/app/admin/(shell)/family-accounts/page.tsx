"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface FamilyAccountRow {
  id: string;
  familyCode: string;
  status: string;
  createdAt: string;
  applicant: { id: string; profileCode: string; fullName: string };
  memberCount: number;
  activeMemberCount: number;
}

export default function FamilyAccountsPage() {
  const [items, setItems] = useState<FamilyAccountRow[] | null>(null);
  const [q, setQ] = useState("");

  function load(query?: string) {
    const params = query ? `?q=${encodeURIComponent(query)}` : "";
    fetch(`/api/admin/family/accounts${params}`).then((r) => (r.ok ? r.json() : null)).then((j) => setItems(j?.items ?? []));
  }
  useEffect(() => load(), []);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Family Accounts</h1>
          <p className="text-sm text-muted">Search and review family/guardian accounts. Admins do not automatically receive unlimited family data.</p>
        </div>
        <Link href="/admin/family-accounts/pending-approvals" className="text-sm text-primary hover:underline">Pending Approvals</Link>
      </div>

      <div className="flex max-w-sm items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by family code or profile code…" onKeyDown={(e) => e.key === "Enter" && load(q)} />
        <button onClick={() => load(q)} className="rounded-lg border border-border p-2 text-muted hover:text-foreground"><Search className="h-4 w-4" /></button>
      </div>

      {items === null ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState icon={Users} title="No family accounts found" /></CardContent></Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {items.map((a) => (
              <Link key={a.id} href={`/admin/family-accounts/${a.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-muted">
                <div>
                  <p className="font-medium">{a.familyCode} — {a.applicant.fullName} ({a.applicant.profileCode})</p>
                  <p className="text-xs text-muted">{a.activeMemberCount} active / {a.memberCount} total members · created {formatDateTime(a.createdAt)}</p>
                </div>
                <Badge variant={a.status === "ACTIVE" ? "success" : "muted"}>{formatEnumLabel(a.status)}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
