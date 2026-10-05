"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, CircleDot, Loader2, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

interface Stage { key: string; label: string; state: "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED"; stateLabel: string }
interface Action { key: string; title: string; reason: string; href: string; order: number }
interface Announcement { id: string; title: string; body: string; language: string }
interface Followup { meetingId: string; scheduledAt: string }
interface Data {
  enabled: boolean;
  language?: "EN" | "UR";
  journey?: { stages: Stage[]; note: string | null; disclaimer: string };
  nextActions?: Action[];
  disclaimer?: string;
  announcements?: Announcement[];
  meetingFollowups?: Followup[];
  feedbackEnabled?: boolean;
}
interface Choice { key: string; EN: string; UR: string }

// STEP 30 - "My journey": where the applicant is on the platform and the optional steps that are open. Wording is fixed and
// neutral (no deadlines, no pressure, no promise about outcomes). The internal activity score is never shown here.
export default function JourneyPage() {
  const { show } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/my-engagement", { cache: "no-store" });
    setData(res.ok ? await res.json() : { enabled: false });
    const fb = await fetch("/api/my-feedback", { cache: "no-store" });
    if (fb.ok) setChoices(((await fb.json()) as { choices?: Choice[] }).choices ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(id: string) {
    await fetch(`/api/my-engagement/announcements/${id}/dismiss`, { method: "POST" });
    void load();
  }

  async function answer(meetingId: string) {
    const choice = pick[meetingId];
    if (!choice) return;
    const res = await fetch("/api/my-feedback/meeting", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetingId, choice }) });
    const json = await res.json().catch(() => ({}));
    show(res.ok ? "Thank you. Our team has your answer." : (json as { error?: string }).error ?? "Could not save your answer.", res.ok ? "success" : "error");
    if (res.ok) void load();
  }

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  if (!data.enabled || !data.journey) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">My Journey</h1>
        <p className="text-sm text-muted">This page is not available yet.</p>
      </div>
    );
  }
  const ur = data.language === "UR";

  return (
    <div className="space-y-6" dir={ur ? "rtl" : "ltr"}>
      <div>
        <h1 className="font-heading text-2xl font-semibold">{ur ? "میرا سفر" : "My Journey"}</h1>
        <p className="mt-1 text-sm text-muted">{data.journey.disclaimer}</p>
      </div>

      {(data.announcements ?? []).map((a) => (
        <Card key={a.id}>
          <CardContent className="flex items-start justify-between gap-3" dir={a.language === "UR" ? "rtl" : "ltr"}>
            <div>
              <p className="font-medium">{a.title}</p>
              <p className="mt-1 text-sm text-muted">{a.body}</p>
            </div>
            <button type="button" onClick={() => dismiss(a.id)} className="rounded p-1 text-muted hover:bg-surface-muted" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="space-y-3">
          <ol className="space-y-3">
            {data.journey.stages.map((s) => {
              const Icon = s.state === "COMPLETED" ? CheckCircle2 : s.state === "IN_PROGRESS" ? CircleDot : Circle;
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <Icon className={s.state === "COMPLETED" ? "h-5 w-5 text-success" : s.state === "IN_PROGRESS" ? "h-5 w-5 text-primary" : "h-5 w-5 text-muted"} />
                  <span className="flex-1 text-sm font-medium">{s.label}</span>
                  <span className="text-xs text-muted">{s.stateLabel}</span>
                </li>
              );
            })}
          </ol>
          {data.journey.note && <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">{data.journey.note}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">{ur ? "ممکنہ اگلے اقدامات" : "Possible next steps"}</h2>
          {(data.nextActions ?? []).length === 0 ? (
            <p className="text-sm text-muted">{ur ? "اس وقت کوئی اقدام باقی نہیں۔" : "There is nothing outstanding right now."}</p>
          ) : (
            <ul className="space-y-3">
              {data.nextActions!.map((a) => (
                <li key={a.key} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="mt-1 text-sm text-muted">{a.reason}</p>
                  <Link href={a.href} className="mt-2 inline-block text-sm text-primary hover:underline">{ur ? "کھولیں" : "Open"}</Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">{data.disclaimer}</p>
        </CardContent>
      </Card>

      {data.feedbackEnabled && (data.meetingFollowups ?? []).length > 0 && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-medium">After your meeting</h2>
            <p className="text-sm text-muted">Optional. Your answer is shared with our team only and does not change anything about a proposal.</p>
            {data.meetingFollowups!.map((m) => (
              <div key={m.meetingId} className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Meeting on {new Date(m.scheduledAt).toLocaleDateString()}</span>
                <Select value={pick[m.meetingId] ?? ""} onChange={(e) => setPick({ ...pick, [m.meetingId]: e.target.value })} className="w-72">
                  <option value="">Choose…</option>
                  {choices.map((c) => <option key={c.key} value={c.key}>{c.EN}</option>)}
                </Select>
                <Button size="sm" onClick={() => answer(m.meetingId)} disabled={!pick[m.meetingId]}>Send</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
