"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface ThreadSummary { id: string; subject: string; type: string; status: string; updatedAt: string }
interface ThreadDetail { thread: { subject: string }; messages: { id: string; from: string; createdAt: string; body: string | null }[] }

// Read-only view of the conversations the applicant's team has shared with this family member (and only while their access is active).
export default function FamilyCommunicationsPage() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [open, setOpen] = useState<ThreadDetail | null>(null);

  useEffect(() => {
    fetch("/api/family/communications").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setThreads(j.items ?? []));
  }, []);

  async function openThread(id: string) {
    const r = await fetch(`/api/family/communications/${id}`);
    if (r.ok) setOpen(await r.json());
  }

  if (!threads) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Messages</h1>
        <p className="mt-1 text-sm text-muted">Conversations the team has shared with you about the applicant. Only what you have been given access to appears here.</p>
      </div>
      {open ? (
        <Card>
          <CardContent className="space-y-3">
            <button type="button" className="text-sm text-primary hover:underline" onClick={() => setOpen(null)}>All conversations</button>
            <h2 className="font-medium">{open.thread.subject}</h2>
            <ul className="space-y-2">
              {open.messages.map((m) => (
                <li key={m.id} className="rounded-lg bg-surface-muted p-3 text-sm">
                  <div className="text-xs text-muted">{m.from === "team" ? "Our team" : m.from === "you" ? "You" : "Family"} · {formatDateTime(m.createdAt)}</div>
                  <p className="mt-1 whitespace-pre-wrap">{m.body ?? "Message unavailable"}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            {threads.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages" />
            ) : (
              <ul className="divide-y divide-border">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => openThread(t.id)} className="flex w-full items-center justify-between gap-2 px-1 py-3 text-left text-sm hover:bg-surface-muted">
                      <span><span className="font-medium">{t.subject}</span><span className="ml-2 text-xs text-muted">{formatEnumLabel(t.type)}</span></span>
                      <span className="text-xs text-muted">{formatDateTime(t.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
