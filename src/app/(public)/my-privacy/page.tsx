"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

const TABS = [
  { value: "data", label: "My Data" },
  { value: "permissions", label: "My Permissions" },
  { value: "activity", label: "My Activity" },
];

const CONSENT_CATEGORIES = [
  "PROFILE_MATCHING", "PROPOSAL_PARTICIPATION", "CONTACT_SHARING", "PHOTO_PROCESSING",
  "VERIFICATION_PROCESSING", "EMAIL_COMMUNICATION", "SMS_COMMUNICATION", "WHATSAPP_COMMUNICATION",
  "ANALYTICS", "AI_ASSISTED_MATCHING", "AI_PROFILE_ASSISTANCE", "AI_COMMUNICATION_ASSISTANCE", "DATA_RETENTION",
];

export default function MyPrivacyPage() {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [tab, setTab] = useState("data");

  useEffect(() => {
    fetch("/api/my-status").then((r) => setSignedIn(r.ok));
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
      setSignedIn(true);
    } finally {
      setLookingUp(false);
    }
  }

  if (signedIn === null) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">My Privacy Dashboard</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to continue.</p>
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
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">My Privacy Dashboard</h1>
        <p className="text-sm text-muted">
          Only information you&apos;re authorized to see. For account actions (deactivate, delete, sessions), visit{" "}
          <Link href="/account-settings" className="text-primary hover:underline">Account Settings</Link>.
        </p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "data" && <MyDataTab />}
      {tab === "permissions" && <MyPermissionsTab />}
      {tab === "activity" && <MyActivityTab />}
    </div>
  );
}

function MyDataTab() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    fetch("/api/my-privacy/data").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  if (!data) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  const sections: [string, unknown][] = [
    ["Personal Information", data.profile],
    ["Contact Information", data.contact],
    ["Education", data.education],
    ["Career", data.profession],
    ["Family", data.family],
    ["Lifestyle", data.lifestyle],
    ["Partner Preferences", data.partnerPreference],
    ["Photos", data.photos],
  ];

  return (
    <div className="space-y-3">
      {sections.map(([label, value]) => (
        <Card key={label}>
          <CardContent>
            <p className="mb-2 text-sm font-medium">{label}</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted">{value ? JSON.stringify(value, null, 2) : "Not provided"}</pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MyPermissionsTab() {
  const { show } = useToast();
  const [effective, setEffective] = useState<Record<string, string> | null>(null);

  function load() {
    fetch("/api/my-privacy/consent").then((r) => (r.ok ? r.json() : null)).then((j) => setEffective(j?.effective ?? {}));
  }
  useEffect(load, []);

  async function toggle(category: string, current: string | undefined) {
    const nextStatus = current === "GRANTED" ? "REVOKED" : "GRANTED";
    const res = await fetch("/api/my-privacy/consent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, status: nextStatus }),
    });
    if (res.status === 409) {
      const confirmed = await fetch("/api/my-privacy/consent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, status: nextStatus, confirmEssential: true }),
      });
      if (confirmed.ok) { show("Updated", "success"); load(); }
      return;
    }
    if (res.ok) { show("Updated", "success"); load(); }
  }

  if (!effective) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <Card>
      <CardContent className="space-y-2">
        {CONSENT_CATEGORIES.map((cat) => {
          const status = effective[cat];
          const granted = status !== "REVOKED";
          return (
            <div key={cat} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <span>{formatEnumLabel(cat)}</span>
              <div className="flex items-center gap-2">
                <Badge variant={granted ? "success" : "muted"}>{granted ? "Granted" : "Revoked"}</Badge>
                <Button size="sm" variant="outline" onClick={() => toggle(cat, status)}>{granted ? "Revoke" : "Grant"}</Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function MyActivityTab() {
  const [activity, setActivity] = useState<{ auditEvents: { action: string; createdAt: string }[]; accessEvents: { action: string; dataCategory: string; createdAt: string }[] } | null>(null);
  useEffect(() => {
    fetch("/api/my-privacy/activity").then((r) => (r.ok ? r.json() : null)).then(setActivity);
  }, []);

  if (!activity) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  const combined = [
    ...activity.auditEvents.map((e) => ({ label: formatEnumLabel(e.action), at: e.createdAt })),
    ...activity.accessEvents.map((e) => ({ label: `${formatEnumLabel(e.action)} (${formatEnumLabel(e.dataCategory)})`, at: e.createdAt })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (combined.length === 0) return <p className="text-sm text-muted">No activity recorded yet.</p>;

  return (
    <Card>
      <CardContent className="space-y-2">
        {combined.map((e, i) => (
          <div key={i} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
            <span>{e.label}</span>
            <span className="text-xs text-muted">{formatDateTime(e.at)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
