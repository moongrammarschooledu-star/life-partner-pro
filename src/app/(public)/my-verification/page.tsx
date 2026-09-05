"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, ShieldCheck, ShieldQuestion, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";
import { CHECKLIST_CATEGORY_LABEL } from "@/lib/verification/checklist-catalog";

interface CompletenessCategory {
  key: string;
  label: string;
  weight: number;
  earnedWeight: number;
  missingFields: string[];
}
interface ChecklistEntry {
  key: string;
  category: string;
  label: string;
  state: "completed" | "under_review" | "action_required" | "pending";
}
interface MyVerification {
  profileCode: string;
  status: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  completeness: { percent: number; categories: CompletenessCategory[] };
  checklist: ChecklistEntry[];
}

const STATE_ICON = { completed: CheckCircle2, under_review: Clock, action_required: AlertTriangle, pending: Clock };
const STATE_LABEL = { completed: "Completed", under_review: "Under Review", action_required: "Action Required", pending: "Pending" };
const STATE_COLOR = { completed: "text-success", under_review: "text-muted", action_required: "text-danger", pending: "text-muted" };

function OtpBox({ channel, verified, onVerified }: { channel: "phone" | "email"; verified: boolean; onVerified: () => void }) {
  const { show } = useToast();
  const [sent, setSent] = useState(false);
  const [destinationMasked, setDestinationMasked] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function sendCode() {
    setSending(true);
    try {
      const res = await fetch(`/api/verify/${channel}/send`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSent(true);
      setDestinationMasked(json.destinationMasked);
      show("Verification code sent.", "success");
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not send code.", "error");
    } finally {
      setSending(false);
    }
  }

  async function confirmCode() {
    setConfirming(true);
    try {
      const body = channel === "phone" ? { code } : { token: code };
      const res = await fetch(`/api/verify/${channel}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      show(`${channel === "phone" ? "Mobile" : "Email"} verified.`, "success");
      onVerified();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not verify.", "error");
    } finally {
      setConfirming(false);
    }
  }

  if (verified) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-success">
        <CheckCircle2 className="h-4 w-4" /> Verified
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!sent ? (
        <Button size="sm" variant="outline" onClick={sendCode} disabled={sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send Verification Code
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Code sent to {destinationMasked}</span>
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" className="w-40" />
          <Button size="sm" onClick={confirmCode} disabled={!code.trim() || confirming}>
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={sendCode} disabled={sending}>
            Resend
          </Button>
        </div>
      )}
    </div>
  );
}

export default function MyVerificationPage() {
  const { show } = useToast();
  const [data, setData] = useState<MyVerification | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  function load() {
    fetch("/api/my-verification")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) {
          setData(json);
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
        <h1 className="font-heading text-2xl font-semibold">My Verification</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to view your verification status.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} View My Verification
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const groups = Object.entries(CHECKLIST_CATEGORY_LABEL).map(([key, label]) => ({
    key,
    label,
    items: data.checklist.filter((c) => c.category === key),
  }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-2xl font-semibold">My Verification</h1>
      <p className="mt-2 text-sm text-muted">
        Verifying your mobile, email, and profile information helps build trust with prospective matches. This never reveals internal review
        scores — only what has actually been checked.
      </p>

      <div className="mt-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {data.status === "VERIFIED" ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldQuestion className="h-4 w-4 text-warning" />}
              Profile: {formatEnumLabel(data.status)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">Profile ID: {data.profileCode}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mobile</CardTitle>
          </CardHeader>
          <CardContent>
            <OtpBox channel="phone" verified={data.phoneVerified} onVerified={load} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Email</CardTitle>
          </CardHeader>
          <CardContent>
            <OtpBox channel="email" verified={data.emailVerified} onVerified={load} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile Completeness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Overall</span>
              <span>{data.completeness.percent}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-muted">
              <div className="h-2.5 rounded-full bg-primary" style={{ width: `${data.completeness.percent}%` }} />
            </div>
            {data.completeness.categories.some((c) => c.missingFields.length > 0) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Missing</p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted">
                  {data.completeness.categories
                    .filter((c) => c.missingFields.length > 0)
                    .map((c) => (
                      <li key={c.key}>
                        {c.label}: {c.missingFields.join(", ")}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification Requirements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</p>
                <ul className="mt-1 space-y-1">
                  {g.items.map((item) => {
                    const Icon = STATE_ICON[item.state];
                    return (
                      <li key={item.key} className={`flex items-center gap-1.5 text-sm ${STATE_COLOR[item.state]}`}>
                        <Icon className="h-3.5 w-3.5 shrink-0" /> {item.label} — {STATE_LABEL[item.state]}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
