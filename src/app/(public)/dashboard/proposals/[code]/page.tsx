"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Heart, X, HelpCircle, Lock, Unlock, CalendarCheck, CalendarX, CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface ProposalDetail {
  proposalCode: string;
  createdAt: string;
  status: string;
  compatibilityScore: number | null;
  compatibilityTier: string | null;
  myResponse: string | null;
  otherProfile: { fullName: string; profileCode: string; age: number; city: string; country: string; education: string | null; profession: string | null; maritalStatus: string; familyType: string | null };
  highlights: string[];
  differences: string[];
  events: { status: string; createdAt: string }[];
  contactPermission: { mine: boolean; theirs: boolean };
  meetings: { id: string; meetingType: string; scheduledAt: string; locationInfo: string | null; participants: string | null; status: string }[];
}

export default function ProposalDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<ProposalDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [proposedAt, setProposedAt] = useState("");
  const [note, setNote] = useState("");

  function load() {
    fetch(`/api/my-proposals/${code}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((j) => j && setData(j));
  }
  useEffect(load, [code]);

  async function respond(response: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/my-proposals/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalCode: code, response }),
      });
      if (res.ok) { show("Response recorded.", "success"); load(); }
    } finally {
      setBusy(false);
    }
  }

  async function contactAction(action: "grant" | "revoke") {
    setBusy(true);
    try {
      const res = await fetch(`/api/my-proposals/${code}/contact-permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) { show(action === "grant" ? "Contact permission granted." : "Contact permission revoked.", "success"); load(); }
    } finally {
      setBusy(false);
    }
  }

  async function confirmMeeting(meetingId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/my-proposals/${code}/meetings/${meetingId}/confirm`, { method: "POST" });
      if (res.ok) { show("Meeting confirmed.", "success"); load(); }
    } finally {
      setBusy(false);
    }
  }

  async function cancelMeeting(meetingId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/my-proposals/${code}/meetings/${meetingId}/cancel`, { method: "POST" });
      if (res.ok) { show("Meeting cancelled.", "success"); load(); }
    } finally {
      setBusy(false);
    }
  }

  async function submitReschedule(meetingId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/my-proposals/${code}/meetings/${meetingId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedAt, note }),
      });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Could not submit.", "error"); return; }
      show("Reschedule request sent to admin.", "success");
      setRescheduleFor(null);
      setProposedAt("");
      setNote("");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
        <p className="text-sm text-muted">Proposal not found.</p>
        <Link href="/my-proposals" className="mt-2 inline-block text-sm text-primary hover:underline">Back to My Proposals</Link>
      </div>
    );
  }

  if (!data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10 sm:px-6">
      <Link href="/my-proposals" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to My Proposals</Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span>{data.otherProfile.fullName}, {data.otherProfile.age}</span>
            <Badge variant="muted">{data.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{data.otherProfile.city}, {data.otherProfile.country}</p>
          <p>{data.otherProfile.education ?? "—"} · {data.otherProfile.profession ?? "—"}</p>
          <p>{formatEnumLabel(data.otherProfile.maritalStatus)}{data.otherProfile.familyType ? ` · ${formatEnumLabel(data.otherProfile.familyType)} family` : ""}</p>
          {data.compatibilityTier && <p className="font-medium text-primary">{data.compatibilityTier}</p>}
        </CardContent>
      </Card>

      {(data.highlights.length > 0 || data.differences.length > 0) && (
        <Card>
          <CardContent className="space-y-2 py-4 text-sm">
            {data.highlights.map((h, i) => <p key={i} className="text-success">✓ {h}</p>)}
            {data.differences.map((d, i) => <p key={i} className="text-muted">• {d}</p>)}
          </CardContent>
        </Card>
      )}

      {!data.myResponse && (
        <Card>
          <CardHeader><CardTitle className="text-base">Your Response</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => respond("INTERESTED")} disabled={busy}><Heart className="h-4 w-4" /> Interested</Button>
            <Button size="sm" variant="outline" onClick={() => respond("NOT_INTERESTED")} disabled={busy}><X className="h-4 w-4" /> Not Interested</Button>
            <Button size="sm" variant="outline" onClick={() => respond("NEED_MORE_INFO")} disabled={busy}><HelpCircle className="h-4 w-4" /> Need More Info</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Contact Permission</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span>Your permission</span>
            <Badge variant={data.contactPermission.mine ? "success" : "muted"}>{data.contactPermission.mine ? "Granted" : "Not granted"}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Their permission</span>
            <Badge variant={data.contactPermission.theirs ? "success" : "muted"}>{data.contactPermission.theirs ? "Granted" : "Not granted"}</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => contactAction(data.contactPermission.mine ? "revoke" : "grant")} disabled={busy}>
            {data.contactPermission.mine ? <><Lock className="h-4 w-4" /> Revoke My Permission</> : <><Unlock className="h-4 w-4" /> Grant My Permission</>}
          </Button>
        </CardContent>
      </Card>

      {data.meetings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Meetings</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data.meetings.map((m) => (
              <div key={m.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{formatEnumLabel(m.meetingType)}</span>
                  <Badge variant="muted">{formatEnumLabel(m.status)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{formatDateTime(m.scheduledAt)}{m.locationInfo ? ` · ${m.locationInfo}` : ""}</p>
                {!["COMPLETED", "CANCELLED"].includes(m.status) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {["REQUESTED", "SCHEDULED"].includes(m.status) && (
                      <Button size="sm" onClick={() => confirmMeeting(m.id)} disabled={busy}><CalendarCheck className="h-4 w-4" /> Confirm</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setRescheduleFor(rescheduleFor === m.id ? null : m.id)}><CalendarClock className="h-4 w-4" /> Propose New Time</Button>
                    <Button size="sm" variant="outline" onClick={() => cancelMeeting(m.id)} disabled={busy}><CalendarX className="h-4 w-4" /> Cancel</Button>
                  </div>
                )}
                {rescheduleFor === m.id && (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <Field label="Proposed New Time" htmlFor={`proposedAt-${m.id}`}>
                      <Input id={`proposedAt-${m.id}`} type="datetime-local" value={proposedAt} onChange={(e) => setProposedAt(e.target.value)} />
                    </Field>
                    <Field label="Note (optional)" htmlFor={`note-${m.id}`}>
                      <Textarea id={`note-${m.id}`} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <Button size="sm" onClick={() => submitReschedule(m.id)} disabled={!proposedAt || busy}>Send to Admin</Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
