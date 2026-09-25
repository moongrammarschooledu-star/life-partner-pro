"use client";

import { useEffect, useState } from "react";
import { Loader2, CalendarCheck, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface Meeting { id: string; meetingType: string; scheduledAt: string; locationInfo: string | null; participants: string | null; status: string; }

export default function FamilyMeetingsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<Meeting[] | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [proposedAt, setProposedAt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/family/meetings").then((r) => (r.ok ? r.json() : null)).then((j) => setItems(j?.items ?? []));
  }
  useEffect(load, []);

  async function confirm(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/family/meetings/${id}/confirm`, { method: "POST" });
      if (res.ok) { show("Meeting confirmed.", "success"); load(); }
      else show((await res.json()).error ?? "Could not confirm.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitReschedule(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/family/meetings/${id}/reschedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposedAt, note }) });
      if (res.ok) { show("Reschedule request sent to admin.", "success"); setRescheduleFor(null); setProposedAt(""); setNote(""); load(); }
      else show((await res.json()).error ?? "Could not submit.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (items === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Meetings</h1>
        <p className="mt-1 text-sm text-muted">Meetings shared with you for coordination.</p>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState title="No meetings shared with you" /></CardContent></Card>
      ) : (
        items.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{formatEnumLabel(m.meetingType)}</span>
                <Badge variant="muted">{formatEnumLabel(m.status)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{formatDateTime(m.scheduledAt)}{m.locationInfo ? ` · ${m.locationInfo}` : ""}</p>
              {m.participants && <p className="text-muted">{m.participants}</p>}
              {!["COMPLETED", "CANCELLED"].includes(m.status) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {["REQUESTED", "SCHEDULED"].includes(m.status) && (
                    <Button size="sm" onClick={() => confirm(m.id)} disabled={busy}><CalendarCheck className="h-4 w-4" /> Confirm</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setRescheduleFor(rescheduleFor === m.id ? null : m.id)}><CalendarClock className="h-4 w-4" /> Propose New Time</Button>
                </div>
              )}
              {rescheduleFor === m.id && (
                <div className="space-y-2 border-t border-border pt-3">
                  <Field label="Proposed New Time" htmlFor={`p-${m.id}`}><Input id={`p-${m.id}`} type="datetime-local" value={proposedAt} onChange={(e) => setProposedAt(e.target.value)} /></Field>
                  <Field label="Note (optional)" htmlFor={`n-${m.id}`}><Textarea id={`n-${m.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  <Button size="sm" onClick={() => submitReschedule(m.id)} disabled={!proposedAt || busy}>Send to Admin</Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
