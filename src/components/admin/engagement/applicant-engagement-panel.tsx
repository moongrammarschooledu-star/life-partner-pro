"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, StatusBadge, timeAgo, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";

// One applicant's engagement view for staff (used on /admin/engagement/users/[id] and as a tab on the CRM record). The platform
// activity figure is for staff only and is labelled as "not a quality or compatibility measure"; it is never shown to the applicant.

interface Data {
  profile: { id: string; profileCode: string; status: string } | null;
  journey: { stages: Array<{ key: string; label: string; state: string; stateLabel: string }>; note: string | null; disclaimer: string };
  nextActions: Array<{ key: string; title: string; reason: string }>;
  activity: { state: string | null; lastActivityAt: string | null; reengagementAttempts: number; optedOut: boolean; score: { score: number; components: Array<{ label: string; points: number; max: number }> }; scoreNote: string };
  events: Array<{ id: string; type: string; occurredAt: string }>;
  reminders: Array<{ id: string; kind: string; state: string; dueAt: string; attempt: number; cancelReason: string | null }>;
  preferences: { remindersEnabled: boolean; reengagementEnabled: boolean; feedbackRequestsEnabled: boolean; quietHoursStart: number | null; quietHoursEnd: number | null; timezone: string | null } | null;
  feedbackCount: number;
}

const KINDS = ["PROFILE_INCOMPLETE", "VERIFICATION_STALLED", "PROPOSAL_PENDING", "MEETING_UNCONFIRMED", "INACTIVITY", "MEMBERSHIP_EXPIRING"];

export function ApplicantEngagementPanel({ profileId, canManage }: { profileId: string; canManage: boolean }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<Data>(`/api/admin/engagement/users/${profileId}`);
  const [kind, setKind] = useState(KINDS[0]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load."} />;

  async function schedule() {
    const ok = await act(show, `/api/admin/engagement/users/${profileId}/reminders`, "POST", { kind }, "Reminder queued. It is only sent if every consent, preference, limit and quiet-hours check allows it.");
    if (ok) reload();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Journey">
          <ol className="space-y-1 text-sm">{data.journey.stages.map((s) => <li key={s.key} className="flex justify-between"><span>{s.label}</span><span className="text-muted">{s.stateLabel}</span></li>)}</ol>
          {data.journey.note && <p className="mt-2 text-xs text-muted">{data.journey.note}</p>}
          <p className="mt-2 text-xs text-muted">{data.journey.disclaimer}</p>
        </Card>
        <Card title="Open steps for this person">
          {data.nextActions.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : <ul className="space-y-2 text-sm">{data.nextActions.map((a) => <li key={a.key}><p className="font-medium">{a.title}</p><p className="text-muted">{a.reason}</p></li>)}</ul>}
        </Card>
        <Card title="Platform activity (staff only)">
          <dl>
            <KV label="Activity band">{data.activity.state ? <StatusBadge status={data.activity.state} /> : "Not recorded"}</KV>
            <KV label="Last activity">{timeAgo(data.activity.lastActivityAt)}</KV>
            <KV label="Re-engagement attempts">{data.activity.reengagementAttempts}</KV>
            <KV label="Opted out of re-engagement">{data.activity.optedOut ? "Yes" : "No"}</KV>
            <KV label="Platform activity figure">{data.activity.score.score} / 100</KV>
          </dl>
          <p className="mt-2 text-xs text-muted">{data.activity.scoreNote}</p>
        </Card>
        <Card title="Their preferences">
          {data.preferences ? (
            <dl>
              <KV label="Reminders">{data.preferences.remindersEnabled ? "On" : "Off"}</KV>
              <KV label="Re-engagement">{data.preferences.reengagementEnabled ? "On" : "Off"}</KV>
              <KV label="Feedback requests">{data.preferences.feedbackRequestsEnabled ? "On" : "Off"}</KV>
              <KV label="Own quiet hours">{data.preferences.quietHoursStart !== null ? `${data.preferences.quietHoursStart}:00–${data.preferences.quietHoursEnd}:00` : "Platform default"}</KV>
            </dl>
          ) : <p className="text-sm text-muted">They have not changed anything (platform defaults apply).</p>}
        </Card>
      </div>

      <Card title="Reminders">
        {canManage && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-60">{KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
            <Button size="sm" onClick={schedule}>Queue a reminder</Button>
          </div>
        )}
        {data.reminders.length === 0 ? <EmptyState title="No reminders" /> : (
          <ul className="divide-y divide-border text-sm">
            {data.reminders.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{r.kind.replace(/_/g, " ").toLowerCase()} <span className="text-xs text-muted">attempt {r.attempt} · {timeAgo(r.dueAt)}{r.cancelReason ? ` · ${r.cancelReason.toLowerCase().replace(/_/g, " ")}` : ""}</span></span>
                <span className="flex items-center gap-2"><StatusBadge status={r.state} />
                  {canManage && ["SCHEDULED", "ELIGIBLE"].includes(r.state) && <Button size="sm" variant="outline" onClick={async () => { const reason = window.prompt("Reason for cancelling"); if (reason && (await act(show, `/api/admin/engagement/reminders/${r.id}/cancel`, "POST", { reason }, "Cancelled."))) reload(); }}>Cancel</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent engagement events">
        {data.events.length === 0 ? <EmptyState title="No events recorded" description="Events are recorded once engagement tracking is switched on." /> : (
          <ul className="divide-y divide-border text-sm">{data.events.map((e) => <li key={e.id} className="flex justify-between gap-2 py-1.5"><span>{e.type.replace(/_/g, " ").toLowerCase()}</span><span className="text-xs text-muted">{timeAgo(e.occurredAt)}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
