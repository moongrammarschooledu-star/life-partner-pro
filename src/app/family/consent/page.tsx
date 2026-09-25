"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface Consent { consentType: string; status: string; grantedAt: string; version: string; }
interface PermissionRow { permission: string; grantedAt: string; expiresAt: string | null; grantedByApplicant: boolean; }
interface SharedRecord { recordType: string; accessLevel: string; allowComments: boolean; allowResponse: boolean; sharedAt: string; expiresAt: string | null; }

const PERMISSIONS = [
  "profile.basic.view", "profile.education.view", "profile.career.view", "profile.family.view", "profile.lifestyle.view",
  "profile.requirements.view", "communication.view", "communication.respond",
];

export default function FamilyConsentPage() {
  const { show } = useToast();
  const [consents, setConsents] = useState<Consent[] | null>(null);
  const [privacy, setPrivacy] = useState<{ permissions: PermissionRow[]; sharedRecords: SharedRecord[] } | null>(null);
  const [requestPermission, setRequestPermission] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function load() {
    fetch("/api/family/consent").then((r) => (r.ok ? r.json() : null)).then((j) => setConsents(j?.items ?? []));
    fetch("/api/family/privacy").then((r) => (r.ok ? r.json() : null)).then(setPrivacy);
  }
  useEffect(load, []);

  async function requestAccess() {
    if (!requestPermission) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/family/access-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestedPermission: requestPermission }) });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Could not submit request.", "error"); return; }
      show(`Request sent — ${json.requestCode}`, "success");
      setRequestPermission("");
    } finally {
      setSubmitting(false);
    }
  }

  if (consents === null || privacy === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Consent &amp; Access</h1>
        <p className="mt-1 text-sm text-muted">What you can access, why, and what has been shared with you.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Your Permissions</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {privacy.permissions.length === 0 ? (
            <p className="text-sm text-muted">No permissions granted yet.</p>
          ) : (
            privacy.permissions.map((p) => (
              <div key={p.permission} className="flex items-center justify-between text-sm">
                <span>{formatEnumLabel(p.permission.replace(/\./g, "_"))}</span>
                <span className="text-xs text-muted">{p.expiresAt ? `until ${formatDateTime(p.expiresAt)}` : "no expiration"}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Shared With You</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {privacy.sharedRecords.length === 0 ? (
            <p className="text-sm text-muted">Nothing shared yet.</p>
          ) : (
            privacy.sharedRecords.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{formatEnumLabel(s.recordType)} — {formatEnumLabel(s.accessLevel)}</span>
                <span className="text-xs text-muted">shared {formatDateTime(s.sharedAt)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Your Consent History</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {consents.map((c, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{formatEnumLabel(c.consentType)}</span>
              <Badge variant={c.status === "GRANTED" ? "success" : "muted"}>{formatEnumLabel(c.status)}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Request Additional Access</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Field label="Permission" htmlFor="requestPermission" className="min-w-56">
            <Select id="requestPermission" value={requestPermission} onChange={(e) => setRequestPermission(e.target.value)}>
              <option value="">Select…</option>
              {PERMISSIONS.map((p) => <option key={p} value={p}>{formatEnumLabel(p.replace(/\./g, "_"))}</option>)}
            </Select>
          </Field>
          <Button size="sm" onClick={requestAccess} disabled={!requestPermission || submitting}>Request</Button>
        </CardContent>
      </Card>
    </div>
  );
}
