"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ClipboardList, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { formatEnumLabel } from "@/lib/utils";

interface ShortlistRow {
  id: string;
  shortlistCode: string;
  name: string;
  status: string;
  updatedAt: string;
  _count: { items: number };
}

export default function ShortlistsPage() {
  const [items, setItems] = useState<ShortlistRow[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  function load() {
    fetch("/api/admin/search/shortlists")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }

  useEffect(load, []);

  async function create() {
    if (!name.trim()) return;
    const res = await fetch("/api/admin/search/shortlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (res.ok) {
      setName("");
      setCreateOpen(false);
      load();
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/candidate-discovery" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Candidate Discovery
      </Link>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold">Shortlists</h1>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Shortlist</Button>
      </div>

      {items === null ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No shortlists yet" description="Create one from Candidate Discovery or here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Shortlist</th>
                <th className="p-3">Name</th>
                <th className="p-3">Candidates</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{s.shortlistCode}</td>
                  <td className="p-3">{s.name}</td>
                  <td className="p-3 text-muted">{s._count.items}</td>
                  <td className="p-3"><Badge variant="muted">{formatEnumLabel(s.status)}</Badge></td>
                  <td className="p-3"><Link href={`/admin/candidate-discovery/shortlists/${s.id}`} className="font-medium text-primary hover:underline">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog open={createOpen} title="New Shortlist" description="Give it a name — you can add candidates afterward." confirmLabel="Create" confirmDisabled={!name.trim()} onConfirm={create} onCancel={() => setCreateOpen(false)}>
        <Field label="Name" htmlFor="short-name"><Input id="short-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </ConfirmDialog>
    </div>
  );
}
