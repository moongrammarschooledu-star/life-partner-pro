"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface ShortlistDetail {
  id: string;
  shortlistCode: string;
  name: string;
  status: string;
  items: Array<{ id: string; position: number; adminNote: string | null; candidate: { id: string; profileCode: string; fullName: string; city: string; profession: string | null; photoUrl: string | null } }>;
}

const STATUSES = ["DRAFT", "REVIEWING", "READY_FOR_PROPOSAL", "ARCHIVED"];

export default function ShortlistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [shortlist, setShortlist] = useState<ShortlistDetail | null>(null);

  function load() {
    fetch(`/api/admin/search/shortlists/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setShortlist)
      .catch(() => setShortlist(null));
  }

  useEffect(load, [id]);

  async function removeItem(itemId: string) {
    const res = await fetch(`/api/admin/search/shortlists/${id}/items/${itemId}`, { method: "DELETE" });
    if (res.ok) load();
    else show("Could not remove candidate.", "error");
  }

  async function changeStatus(status: string) {
    const res = await fetch(`/api/admin/search/shortlists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) load();
    else show("Could not update status.", "error");
  }

  if (!shortlist) {
    return (
      <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/candidate-discovery/shortlists" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Shortlists
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{shortlist.name}</h1>
          <p className="font-mono text-xs text-muted">{shortlist.shortlistCode}</p>
        </div>
        <Select value={shortlist.status} onChange={(e) => changeStatus(e.target.value)} className="w-48">
          {STATUSES.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}
        </Select>
      </div>

      {shortlist.items.length === 0 ? (
        <p className="text-sm text-muted">No candidates in this shortlist yet — add them from Candidate Discovery.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shortlist.items.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <div className="flex items-start justify-between">
                <div className="h-16 w-16 overflow-hidden rounded-lg bg-surface-muted">
                  {item.candidate.photoUrl ? <img src={item.candidate.photoUrl} alt="" className="h-full w-full object-cover" /> : null}
                </div>
                <button onClick={() => removeItem(item.id)} className="text-muted hover:text-danger"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-2 font-mono text-xs text-muted">{item.candidate.profileCode}</p>
              <p className="font-medium">{item.candidate.fullName}</p>
              <p className="text-xs text-muted">{item.candidate.city} · {item.candidate.profession ?? "—"}</p>
              {item.adminNote && <p className="mt-1 text-xs italic text-muted">{item.adminNote}</p>}
              <Link href={`/admin/profiles/${item.candidate.id}`} className="mt-2 block text-center text-xs font-medium text-primary hover:underline">View Profile</Link>
            </div>
          ))}
        </div>
      )}
      <Badge variant="muted">{shortlist.items.length} candidate(s)</Badge>
    </div>
  );
}
