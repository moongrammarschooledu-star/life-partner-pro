"use client";

import { useEffect, useState } from "react";
import { Send, Loader2, Pin, PinOff, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea, Select, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Timeline } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { cn, formatDateTime, formatEnumLabel } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { StickyNote, MessageCircleHeart, Bell } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";

interface CommunicationEntry {
  id: string;
  type: string;
  notes: string | null;
  occurredAt: string;
  followUpDate: string | null;
  adminName: string;
}

interface AutomatedLogEntry {
  id: string;
  channel: string;
  notificationType: string;
  deliveryStatus: string;
  createdAt: string;
  isTest: boolean;
  createdBy: { name: string } | null;
}

interface Note {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: string | Date;
  adminName: string;
  isOwnNote?: boolean;
}

export function NotesTab({ profileId, notes: initialNotes }: { profileId: string; notes: Note[] }) {
  const { show } = useToast();
  const [notes, setNotes] = useState(initialNotes);
  const [text, setText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const [commType, setCommType] = useState("PHONE_CALL");
  const [commNotes, setCommNotes] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [submittingComm, setSubmittingComm] = useState(false);
  const [history, setHistory] = useState<CommunicationEntry[] | null>(null);
  const [automatedHistory, setAutomatedHistory] = useState<AutomatedLogEntry[] | null>(null);

  function loadHistory() {
    fetch(`/api/admin/communications?profileId=${profileId}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.items ?? []));
  }

  function loadAutomatedHistory() {
    fetch(`/api/admin/communication-center?profileId=${profileId}&includeTest=true`)
      .then((r) => r.json())
      .then((data) => setAutomatedHistory(data.items ?? []));
  }

  useEffect(() => {
    loadHistory();
    loadAutomatedHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function addNote() {
    if (!text.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      const note = await res.json();
      setNotes((prev) => [note, ...prev]);
      setText("");
      show("Note added", "success");
    } catch {
      show("Could not add note.", "error");
    } finally {
      setSubmittingNote(false);
    }
  }

  async function togglePin(note: Note) {
    const res = await fetch(`/api/admin/profiles/${profileId}/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    if (!res.ok) {
      show("Could not update note.", "error");
      return;
    }
    setNotes((prev) =>
      [...prev.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n))].sort((a, b) => Number(b.pinned) - Number(a.pinned))
    );
  }

  async function deleteNote(id: string) {
    const res = await fetch(`/api/admin/profiles/${profileId}/notes/${id}`, { method: "DELETE" });
    setDeleteTarget(null);
    if (!res.ok) {
      show("Could not delete note.", "error");
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
    show("Note deleted", "success");
  }

  async function logCommunication() {
    setSubmittingComm(true);
    try {
      const res = await fetch("/api/admin/communications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, type: commType, notes: commNotes, followUpDate: followUpDate || undefined }),
      });
      if (!res.ok) throw new Error();
      show("Communication logged", "success");
      setCommNotes("");
      setFollowUpDate("");
      loadHistory();
    } catch {
      show("Could not log communication.", "error");
    } finally {
      setSubmittingComm(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Internal Notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Textarea placeholder="Add an internal note..." value={text} onChange={(e) => setText(e.target.value)} className="min-h-16" />
          </div>
          <Button size="sm" onClick={addNote} disabled={submittingNote || !text.trim()}>
            {submittingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Add Note
          </Button>

          <div className="space-y-3 pt-2">
            {notes.length === 0 ? (
              <EmptyState icon={StickyNote} title="No notes yet" />
            ) : (
              notes.map((n) => (
                <div key={n.id} className={cn("rounded-lg border p-3 text-sm", n.pinned ? "border-accent bg-accent/5" : "border-border")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex-1">{n.text}</p>
                    {n.isOwnNote !== false && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => togglePin(n)}
                          title={n.pinned ? "Unpin" : "Pin"}
                          className="text-muted hover:text-accent"
                        >
                          {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => setDeleteTarget(n.id)} title="Delete" className="text-muted hover:text-danger">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {n.adminName} &middot; {formatDateTime(n.createdAt)}
                    {n.isOwnNote === false && " · Private to author"}
                  </p>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Log Communication</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={commType} onChange={(e) => setCommType(e.target.value)}>
            <option value="PHONE_CALL">Phone Call</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
            <option value="MEETING">Meeting</option>
            <option value="FOLLOW_UP">Follow-up</option>
          </Select>
          <Textarea placeholder="Notes about this communication" value={commNotes} onChange={(e) => setCommNotes(e.target.value)} />
          <div>
            <label className="text-sm font-medium">Follow-up date (optional)</label>
            <Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="mt-1.5" />
          </div>
          <Button size="sm" onClick={logCommunication} disabled={submittingComm}>
            {submittingComm && <Loader2 className="h-4 w-4 animate-spin" />} Save Communication
          </Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Communication History</CardTitle>
        </CardHeader>
        <CardContent>
          {history === null ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : history.length === 0 ? (
            <EmptyState icon={MessageCircleHeart} title="No communication history" description="Logged calls, messages, and meetings will appear here." />
          ) : (
            <Timeline
              items={history.map((c) => ({
                id: c.id,
                label: formatEnumLabel(c.type),
                description: [c.notes, c.adminName ? `by ${c.adminName}` : null].filter(Boolean).join(" — ") || undefined,
                date: c.occurredAt,
              }))}
            />
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Automated Notification History</CardTitle>
        </CardHeader>
        <CardContent>
          {automatedHistory === null ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          ) : automatedHistory.length === 0 ? (
            <EmptyState icon={Bell} title="No automated notifications yet" description="System-triggered emails, SMS, WhatsApp, and in-app notifications appear here." />
          ) : (
            <div className="space-y-1.5">
              {automatedHistory.map((log) => (
                <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{formatDateTime(log.createdAt)}</span>
                    <Badge variant="muted">{formatEnumLabel(log.channel)}</Badge>
                    <span className="text-muted">{formatEnumLabel(log.notificationType)}</span>
                    {log.isTest && <Badge variant="warning">Test</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    {log.createdBy && <span className="text-muted">by {log.createdBy.name}</span>}
                    <StatusBadge status={log.deliveryStatus} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this note?"
        description="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleteTarget && deleteNote(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
