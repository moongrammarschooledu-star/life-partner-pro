"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Loader2, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";

interface DocItem { id: string; documentCode: string; typeKey: string; status: string; verificationStatus: string; originalFilename: string; expiresAt: string | null; createdAt: string }
interface RequestItem { id: string; requestCode: string; typeKey: string; purpose: string; status: string; dueDate: string | null }

// My Documents. Sections per spec §20: My Documents, Requests from Admin, Expiring Soon.
export default function MyDocumentsPage() {
  const [items, setItems] = useState<DocItem[] | null>(null);
  const [requests, setRequests] = useState<RequestItem[] | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/my-documents").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setItems(j.items ?? []));
    fetch("/api/my-documents/requests").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setRequests(j.items ?? []));
  }, []);

  if (!items) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  const openRequests = (requests ?? []).filter((r) => ["SENT", "VIEWED"].includes(r.status));
  const expiringSoon = items.filter((d) => d.expiresAt && new Date(d.expiresAt).getTime() - now < 30 * 86_400_000);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-16 sm:px-6">
      <div>
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold">My Documents</h1>
          <Link href="/dashboard/documents/upload"><Button size="sm"><Plus className="h-4 w-4" /> Upload</Button></Link>
        </div>
        <p className="mt-1 text-sm text-muted">Your documents stay private. Nothing here is ever shared without your explicit approval.</p>
      </div>

      {openRequests.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="font-medium">Requests from our team</h2>
            {openRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 p-3 text-sm">
                <span>{formatEnumLabel(r.typeKey)} — {r.purpose}{r.dueDate ? ` (by ${new Date(r.dueDate).toLocaleDateString()})` : ""}</span>
                <Link href={`/dashboard/documents/upload?requestId=${r.id}&typeKey=${r.typeKey}`}><Button size="sm">Upload</Button></Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {expiringSoon.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="font-medium">Expiring soon</h2>
            {expiringSoon.map((d) => <p key={d.id} className="text-sm">{formatEnumLabel(d.typeKey)} expires {d.expiresAt && new Date(d.expiresAt).toLocaleDateString()}.</p>)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet" description="Upload a document when it's needed for verification or a request." />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((d) => (
                <li key={d.id}>
                  <Link href={`/dashboard/documents/${d.id}`} className="flex flex-wrap items-center justify-between gap-2 px-1 py-3 text-sm hover:bg-surface-muted">
                    <span><span className="font-medium">{formatEnumLabel(d.typeKey)}</span> <span className="ml-2 text-xs text-muted">{d.originalFilename}</span></span>
                    <span className="flex items-center gap-2"><StatusBadge status={d.verificationStatus === "NOT_SUBMITTED" ? d.status : d.verificationStatus} /><span className="text-xs text-muted">{formatDateTime(d.createdAt)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
