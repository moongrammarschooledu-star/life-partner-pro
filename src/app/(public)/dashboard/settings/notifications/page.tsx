"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

interface Prefs {
  quietHoursEnabled: boolean; quietHoursStart: number | null; quietHoursEnd: number | null; timezone: string | null;
  maxDailyNotifications: number | null; remindersEnabled: boolean; reengagementEnabled: boolean; feedbackRequestsEnabled: boolean;
}
interface PrefResponse { preferences: Prefs; defaults: { quietHoursStart: number; quietHoursEnd: number; timezone: string; maxDailyNotifications: number }; note: string }
type ChannelPrefs = Record<string, boolean>;

const CHANNELS = [["in-app", "inApp", "In-app"], ["email", "email", "Email"], ["sms", "sms", "SMS"], ["whatsapp", "whatsapp", "WhatsApp"]] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

// STEP 30 - one place to control how often and when reminders reach you. Channel switches and consent are the existing
// notification preferences (this page reads and writes the same record); the extra switches below only affect reminder and
// re-engagement messages. Security, verification and account notices are never switched off by anything here.
export default function NotificationSettingsPage() {
  const { show } = useToast();
  const [data, setData] = useState<PrefResponse | null>(null);
  const [channels, setChannels] = useState<ChannelPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/my-engagement/preferences", { cache: "no-store" }), fetch("/api/my-notifications/preferences", { cache: "no-store" })]);
    if (a.ok) setData(await a.json());
    if (b.ok) setChannels(((await b.json()) as { preferences: ChannelPrefs | null }).preferences ?? {});
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  const p = data.preferences;
  const set = (patch: Partial<Prefs>) => setData({ ...data, preferences: { ...p, ...patch } });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/my-engagement/preferences", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quietHoursEnabled: p.quietHoursEnabled, quietHoursStart: p.quietHoursStart, quietHoursEnd: p.quietHoursEnd, timezone: p.timezone, maxDailyNotifications: p.maxDailyNotifications, remindersEnabled: p.remindersEnabled, reengagementEnabled: p.reengagementEnabled, feedbackRequestsEnabled: p.feedbackRequestsEnabled }),
      });
      const chRes = channels
        ? await fetch("/api/my-notifications/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: channels }) })
        : { ok: true };
      const json = await res.json().catch(() => ({}));
      show(res.ok && chRes.ok ? "Your settings are saved." : (json as { error?: string }).error ?? "Could not save your settings.", res.ok && chRes.ok ? "success" : "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Notification settings</h1>
        <p className="mt-1 text-sm text-muted">{data.note}</p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">Reminders</h2>
          <Checkbox checked={p.remindersEnabled} onChange={(e) => set({ remindersEnabled: e.target.checked })} label="Send me gentle reminders about things I have not finished" />
          <Checkbox checked={p.reengagementEnabled} onChange={(e) => set({ reengagementEnabled: e.target.checked })} label="Let me know if I have been away for a while" />
          <Checkbox checked={p.feedbackRequestsEnabled} onChange={(e) => set({ feedbackRequestsEnabled: e.target.checked })} label="Ask for my feedback sometimes" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">Quiet hours</h2>
          <p className="text-sm text-muted">Reminders wait until quiet hours end. By default they pause from {hourLabel(data.defaults.quietHoursStart)} to {hourLabel(data.defaults.quietHoursEnd)} ({data.defaults.timezone}).</p>
          <Checkbox checked={p.quietHoursEnabled} onChange={(e) => set({ quietHoursEnabled: e.target.checked })} label="Use my own quiet hours" />
          {p.quietHoursEnabled && (
            <div className="flex flex-wrap gap-3">
              <Field label="From"><Select value={p.quietHoursStart ?? data.defaults.quietHoursStart} onChange={(e) => set({ quietHoursStart: Number(e.target.value) })} className="w-28">{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select></Field>
              <Field label="Until"><Select value={p.quietHoursEnd ?? data.defaults.quietHoursEnd} onChange={(e) => set({ quietHoursEnd: Number(e.target.value) })} className="w-28">{HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</Select></Field>
            </div>
          )}
          <Field label="Most reminders per day" hint={`The platform limit is ${data.defaults.maxDailyNotifications}; you can choose fewer.`}>
            <Select value={p.maxDailyNotifications ?? ""} onChange={(e) => set({ maxDailyNotifications: e.target.value ? Number(e.target.value) : null })} className="w-40">
              <option value="">Platform default</option>
              {Array.from({ length: data.defaults.maxDailyNotifications }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      {channels && (
        <Card>
          <CardContent className="space-y-3">
            <h2 className="font-medium">Where reminders can reach you</h2>
            <p className="text-sm text-muted">Email, SMS and WhatsApp messages are sent only where you have given permission. Push notifications are not available yet.</p>
            {CHANNELS.map(([, prefix, label]) => (
              <Checkbox key={prefix} checked={channels[`${prefix}FollowUpReminders`] ?? true} onChange={(e) => setChannels({ ...channels, [`${prefix}FollowUpReminders`]: e.target.checked })} label={`${label} reminders`} />
            ))}
          </CardContent>
        </Card>
      )}

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
    </div>
  );
}
