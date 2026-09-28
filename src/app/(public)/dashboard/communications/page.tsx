"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MessageSquare, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface ThreadSummary { id: string; threadCode: string; type: string; subject: string; status: string; updatedAt: string }
interface ThreadDetail { thread: { id: string; subject: string; status: string; canReply: boolean }; messages: { id: string; from: "you" | "team"; createdAt: string; body: string | null }[] }
interface HistoryItem { id: string; channel: string; about: string; to: string | null; status: string; sentAt: string | null; deliveredAt: string | null; createdAt: string }

// The applicant's conversations with the support team (never with another applicant) and a safe history of what was sent to them.
export default function MyCommunicationsPage() {
  const { show } = useToast();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [open, setOpen] = useState<ThreadDetail | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/my-communications")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setSignedIn(Boolean(json));
        setThreads(json?.items ?? []);
      });
    fetch("/api/my-communications/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setHistory(json?.items ?? []));
  }, []);

  async function openThread(id: string) {
    const r = await fetch(`/api/my-communications/${id}`);
    if (!r.ok) return show("Could not open this conversation.", "error");
    setOpen(await r.json());
  }

  async function send() {
    if (!open || !reply.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/my-communications/${open.thread.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: reply }) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        return show(j.error ?? "Could not send your reply.", "error");
      }
      setReply("");
      await openThread(open.thread.id);
    } finally {
      setBusy(false);
    }
  }

  if (signedIn === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">My Messages</h1>
        <p className="mt-2 text-sm text-muted">Please view your notifications first to confirm who you are, then come back here.</p>
        <Link href="/my-notifications" className="mt-4 inline-block text-sm text-primary hover:underline">Go to My Notifications</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-16 sm:px-6">
      <div>
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold">My Messages</h1>
        <p className="mt-1 text-sm text-muted">Conversations with our team about your account, proposals and meetings. Conversations are only ever between you and our team — never with another applicant — and we never share anyone&apos;s contact details here.</p>
      </div>

      {open ? (
        <Card>
          <CardContent className="space-y-3">
            <button type="button" className="text-sm text-primary hover:underline" onClick={() => setOpen(null)}>All conversations</button>
            <h2 className="font-medium">{open.thread.subject}</h2>
            <ul className="space-y-2">
              {open.messages.map((m) => (
                <li key={m.id} className={`rounded-lg p-3 text-sm ${m.from === "you" ? "ml-8 bg-primary/10" : "mr-8 bg-surface-muted"}`}>
                  <div className="text-xs text-muted">{m.from === "you" ? "You" : "Our team"} · {formatDateTime(m.createdAt)}</div>
                  <p className="mt-1 whitespace-pre-wrap">{m.body ?? "Message unavailable"}</p>
                </li>
              ))}
              {open.messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
            </ul>
            {open.thread.canReply ? (
              <div className="space-y-2">
                <Textarea rows={3} value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
                <p className="text-xs text-muted">Please don&apos;t include passwords or one-time codes. Our team will never ask for them.</p>
                <Button onClick={send} disabled={busy || !reply.trim()}><Send className="h-4 w-4" /> Send reply</Button>
              </div>
            ) : (
              <p className="text-sm text-muted">This conversation is closed.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent>
            {threads && threads.length > 0 ? (
              <ul className="divide-y divide-border">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => openThread(t.id)} className="flex w-full items-center justify-between gap-2 px-1 py-3 text-left text-sm hover:bg-surface-muted">
                      <span><span className="font-medium">{t.subject}</span><span className="ml-2 text-xs text-muted">{formatEnumLabel(t.type)}</span></span>
                      <span className="text-xs text-muted">{t.status === "OPEN" ? formatDateTime(t.updatedAt) : "Closed"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={MessageSquare} title="No conversations" description="When our team needs to talk with you about something, it will appear here." />
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="font-heading text-lg font-semibold">What we&apos;ve sent you</h2>
        <p className="mt-1 text-sm text-muted">E-mail, SMS and WhatsApp messages sent to you. &ldquo;Delivered&rdquo; appears only when the provider confirmed it.</p>
        <Card className="mt-3">
          <CardContent>
            {history.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="divide-y divide-border text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{formatEnumLabel(h.channel)} · {formatEnumLabel(h.about)} <span className="text-xs text-muted">to {h.to ?? "your address"}</span></span>
                    <span className="text-xs text-muted">{formatEnumLabel(h.status)} · {formatDateTime(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
