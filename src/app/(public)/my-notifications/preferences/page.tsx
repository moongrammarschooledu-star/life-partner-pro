"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Save, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Checkbox, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface Preferences {
  inAppProposalUpdates: boolean;
  inAppMeetingUpdates: boolean;
  inAppFollowUpReminders: boolean;
  inAppMarketing: boolean;
  emailProposalUpdates: boolean;
  emailMeetingUpdates: boolean;
  emailFollowUpReminders: boolean;
  emailMarketing: boolean;
  smsProposalUpdates: boolean;
  smsMeetingUpdates: boolean;
  smsFollowUpReminders: boolean;
  smsMarketing: boolean;
  whatsappProposalUpdates: boolean;
  whatsappMeetingUpdates: boolean;
  whatsappFollowUpReminders: boolean;
  whatsappMarketing: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  inAppProposalUpdates: true, inAppMeetingUpdates: true, inAppFollowUpReminders: true, inAppMarketing: false,
  emailProposalUpdates: true, emailMeetingUpdates: true, emailFollowUpReminders: true, emailMarketing: false,
  smsProposalUpdates: true, smsMeetingUpdates: true, smsFollowUpReminders: true, smsMarketing: false,
  whatsappProposalUpdates: true, whatsappMeetingUpdates: true, whatsappFollowUpReminders: true, whatsappMarketing: false,
};

const CHANNELS: { key: "inApp" | "email" | "sms" | "whatsapp"; label: string; consentChannel?: "EMAIL" | "SMS" | "WHATSAPP" }[] = [
  { key: "inApp", label: "In-App" },
  { key: "email", label: "Email", consentChannel: "EMAIL" },
  { key: "sms", label: "SMS", consentChannel: "SMS" },
  { key: "whatsapp", label: "WhatsApp", consentChannel: "WHATSAPP" },
];

const CATEGORIES: { key: "ProposalUpdates" | "MeetingUpdates" | "FollowUpReminders" | "Marketing"; label: string }[] = [
  { key: "ProposalUpdates", label: "Proposal Updates" },
  { key: "MeetingUpdates", label: "Meeting Updates" },
  { key: "FollowUpReminders", label: "Follow-Up Reminders" },
  { key: "Marketing", label: "Marketing / Promotional Messages" },
];

export default function NotificationPreferencesPage() {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [consent, setConsent] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<"EN" | "UR">("EN");
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/my-notifications/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) {
          setPrefs({ ...DEFAULT_PREFERENCES, ...(json.preferences ?? {}) });
          setConsent(json.consent ?? {});
          setLanguage(json.preferredLanguage ?? "EN");
          setSignedIn(true);
        } else {
          setSignedIn(false);
        }
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function lookup() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Profile not found.", "error");
        return;
      }
      load();
    } finally {
      setLookingUp(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/my-notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      });
      if (!res.ok) throw new Error();
      show("Preferences saved", "success");
    } catch {
      show("Could not save preferences.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveLanguage(next: "EN" | "UR") {
    setLanguage(next);
    setSavingLanguage(true);
    try {
      const res = await fetch("/api/my-notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredLanguage: next }),
      });
      if (!res.ok) throw new Error();
      show("Language updated", "success");
    } catch {
      show("Could not update language.", "error");
    } finally {
      setSavingLanguage(false);
    }
  }

  async function toggleConsent(channel: "EMAIL" | "SMS" | "WHATSAPP") {
    const nextStatus = consent[channel] === "REVOKED" ? "GRANTED" : "REVOKED";
    try {
      const res = await fetch("/api/my-notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: [{ channel, status: nextStatus }] }),
      });
      if (!res.ok) throw new Error();
      setConsent((prev) => ({ ...prev, [channel]: nextStatus }));
      show(nextStatus === "REVOKED" ? `${channel} consent revoked` : `${channel} consent granted`, "success");
    } catch {
      show("Could not update consent.", "error");
    }
  }

  if (signedIn === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Notification Settings</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Link href="/my-notifications" className="flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Notifications
      </Link>
      <h1 className="mt-2 font-heading text-2xl font-semibold">Notification Settings</h1>
      <p className="mt-2 text-sm text-muted">
        Control which non-essential updates you receive on each channel. Account and verification/security notifications are
        always sent and cannot be disabled here.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Language</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Notification Language" htmlFor="language" hint="Applies to email, SMS, and WhatsApp copy where available; falls back to English if a translation is missing.">
            <Select id="language" value={language} onChange={(e) => saveLanguage(e.target.value as "EN" | "UR")} disabled={savingLanguage}>
              <option value="EN">English</option>
              <option value="UR">اردو (Urdu)</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2">Category</th>
                  {CHANNELS.map((c) => (
                    <th key={c.key} className="pb-2 text-center">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((cat) => (
                  <tr key={cat.key} className="border-t border-border">
                    <td className="py-2 pr-2">{cat.label}</td>
                    {CHANNELS.map((ch) => {
                      const field = `${ch.key}${cat.key}` as keyof Preferences;
                      return (
                        <td key={ch.key} className="py-2 text-center">
                          <Checkbox
                            label=""
                            checked={prefs[field]}
                            onChange={(e) => setPrefs({ ...prefs, [field]: e.target.checked })}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button size="sm" className="mt-4" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Preferences
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Channel Consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted">
            Revoking consent stops non-essential Email/SMS/WhatsApp messages on that channel. Essential account/security
            notifications may still be sent where required.
          </p>
          {CHANNELS.filter((c) => c.consentChannel).map((c) => (
            <div key={c.key} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{c.label}</span>
              <div className="flex items-center gap-2">
                <span className={consent[c.consentChannel!] === "REVOKED" ? "text-danger" : "text-success"}>
                  {consent[c.consentChannel!] === "REVOKED" ? "Revoked" : "Granted"}
                </span>
                <Button size="sm" variant="outline" onClick={() => toggleConsent(c.consentChannel!)}>
                  {consent[c.consentChannel!] === "REVOKED" ? "Grant" : "Revoke"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
