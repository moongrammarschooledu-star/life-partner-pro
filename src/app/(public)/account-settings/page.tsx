"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, Lock, Smartphone, Bell, ShieldOff, Download, PauseCircle, PlayCircle, Trash2, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";
import { ReauthDialog } from "@/components/public/account/reauth-dialog";

interface AccountStatusInfo {
  profileCode: string;
  accountStatus: string;
}
interface SessionRow {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  isCurrent: boolean;
}

function AccountSettingsInner() {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [status, setStatus] = useState<AccountStatusInfo | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [dialog, setDialog] = useState<"deactivate" | "reactivate" | "delete" | "export" | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  function load() {
    fetch("/api/my-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json) {
          setStatus({ profileCode: json.profileCode, accountStatus: "ACTIVE" });
          setSignedIn(true);
          loadSessions();
        } else {
          setSignedIn(false);
        }
      });
  }
  function loadSessions() {
    fetch("/api/my-account/sessions").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setSessions(j.items ?? []));
  }

  useEffect(load, []);

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

  async function revokeSession(id: string) {
    const res = await fetch(`/api/my-account/sessions/${id}`, { method: "DELETE" });
    if (res.ok) {
      show("Session signed out.", "success");
      loadSessions();
    }
  }

  async function revokeOthers() {
    const res = await fetch("/api/my-account/sessions/revoke-others", { method: "POST" });
    if (res.ok) {
      show("Other sessions signed out.", "success");
      loadSessions();
    }
  }

  async function handleDeactivate(reauthToken: string) {
    const res = await fetch("/api/my-account/deactivate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reauthToken }) });
    if (res.ok) {
      show("Account deactivated.", "success");
      setDialog(null);
    } else {
      show((await res.json()).error ?? "Could not deactivate.", "error");
    }
  }
  async function handleReactivate(reauthToken: string) {
    const res = await fetch("/api/my-account/reactivate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reauthToken }) });
    if (res.ok) {
      show("Account reactivated.", "success");
      setDialog(null);
    } else {
      show((await res.json()).error ?? "Could not reactivate.", "error");
    }
  }
  async function handleDelete(reauthToken: string) {
    const res = await fetch("/api/my-account/deletion-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reauthToken, reason: deleteReason }) });
    const json = await res.json();
    if (res.ok) {
      show(`Deletion requested — ${json.requestCode}`, "success");
      setDialog(null);
    } else {
      show(json.error ?? "Could not submit deletion request.", "error");
    }
  }
  async function handleExport(reauthToken: string) {
    const res = await fetch("/api/my-account/export-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reauthToken }) });
    const json = await res.json();
    if (res.ok) {
      show("Your data export is ready.", "success");
      setDialog(null);
      window.location.href = `/api/my-account/download-export/${json.requestId}?token=${encodeURIComponent(json.downloadToken)}`;
    } else {
      show(json.error ?? "Could not create export.", "error");
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
        <h1 className="font-heading text-2xl font-semibold">Account Settings</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to manage your account.</p>
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
      <h1 className="font-heading text-2xl font-semibold">Account Settings</h1>
      <p className="text-sm text-muted">Manage your account, security, privacy, and data — separate from your matrimonial profile information.</p>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Smartphone className="h-4 w-4" /> Personal &amp; Contact</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/update-request" className={buttonClass({ variant: "outline", size: "sm" })}>Request a Correction</Link>
          <Link href="/my-verification" className={buttonClass({ variant: "outline", size: "sm" })}>Phone &amp; Email Verification</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Monitor className="h-4 w-4" /> Security &amp; Sessions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sessions === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted">No active sessions on record yet.</p>
          ) : (
            <>
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <div>
                    <p className="font-medium">{s.deviceInfo ?? "Unknown device"} {s.isCurrent && <Badge variant="success">This device</Badge>}</p>
                    <p className="text-xs text-muted">Last active {formatDateTime(s.lastActiveAt)}</p>
                  </div>
                  {!s.isCurrent && <Button size="sm" variant="outline" onClick={() => revokeSession(s.id)}>Sign Out</Button>}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={revokeOthers}>Log Out Other Sessions</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" /> Privacy</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/my-privacy" className={buttonClass({ variant: "outline", size: "sm" })}>Open My Privacy Dashboard</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" /> Notifications</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/my-notifications/preferences" className={buttonClass({ variant: "outline", size: "sm" })}>Notification Preferences</Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldOff className="h-4 w-4" /> Account Status</CardTitle></CardHeader>
        <CardContent>
          <Badge variant="muted">{formatEnumLabel(status?.accountStatus ?? "ACTIVE")}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4" /> Download My Data</CardTitle></CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">Get a copy of your personal profile, education, career, family, lifestyle, partner preferences, consent history, and your own proposal/support-case information.</p>
          <Button size="sm" variant="outline" onClick={() => setDialog("export")}>Request Export</Button>
        </CardContent>
      </Card>

      <Card className="border-warning/40">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><PauseCircle className="h-4 w-4" /> Deactivate Account</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted">Removes your profile from active matching, prevents new proposals, and stops optional notifications. Your information is preserved and you can reactivate later.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog("deactivate")}>
              <PauseCircle className="h-4 w-4" /> Deactivate
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDialog("reactivate")}>
              <PlayCircle className="h-4 w-4" /> Reactivate
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-danger/40">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trash2 className="h-4 w-4" /> Delete Account</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted">Requests permanent deletion or anonymization of your data. This is reviewed by our team, follows a cooling-off period, and cannot be undone once processed.</p>
          <Button size="sm" variant="outline" onClick={() => setDialog("delete")}>Request Account Deletion</Button>
        </CardContent>
      </Card>

      <ReauthDialog
        open={dialog === "deactivate"}
        title="Deactivate Account"
        description="Your profile will be removed from active matching, new proposals will be blocked, and optional notifications will stop. Required operational records are preserved. Confirm your identity to continue."
        danger
        onCancel={() => setDialog(null)}
        onConfirmed={handleDeactivate}
      />
      <ReauthDialog
        open={dialog === "reactivate"}
        title="Reactivate Account"
        description="Your account will be re-enabled. Restrictions or suspensions that were explicitly applied are not automatically lifted, and expired verification may need to be redone."
        onCancel={() => setDialog(null)}
        onConfirmed={handleReactivate}
      />
      <ReauthDialog
        open={dialog === "export"}
        title="Download My Data"
        description="We'll prepare a secure, time-limited download of your data. Confirm your identity to continue."
        onCancel={() => setDialog(null)}
        onConfirmed={handleExport}
      />
      <ReauthDialog
        open={dialog === "delete"}
        title="Request Account Deletion"
        description="This creates a deletion request our team reviews before anything is removed. Confirm your identity to continue."
        danger
        onCancel={() => setDialog(null)}
        onConfirmed={handleDelete}
      >
        <Field label="Reason (optional)" htmlFor="delete-reason">
          <Textarea id="delete-reason" rows={2} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
        </Field>
      </ReauthDialog>
    </div>
  );
}

export default function AccountSettingsPage() {
  return <AccountSettingsInner />;
}
