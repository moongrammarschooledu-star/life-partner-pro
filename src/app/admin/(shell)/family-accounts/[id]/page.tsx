"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Ban } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface Member {
  id: string;
  fullName: string;
  relationship: string;
  role: string;
  status: string;
  email: string | null;
  lastLoginAt: string | null;
  permissions: { permission: string; scope: string | null; status: string; grantedAt: string; expiresAt: string | null }[];
  sharedRecords: { recordType: string; recordId: string; accessLevel: string; status: string }[];
  sessions: { id: string; deviceInfo: string | null; lastActiveAt: string }[];
}
interface AccountDetail {
  id: string;
  familyCode: string;
  status: string;
  applicant: { profileCode: string; fullName: string };
  members: Member[];
}

export default function AdminFamilyAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<AccountDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch(`/api/admin/family/accounts/${id}`).then((r) => (r.ok ? r.json() : null)).then(setData);
  }
  useEffect(load, [id]);

  async function suspend(memberId: string, permanent: boolean) {
    const reason = prompt(permanent ? "Reason for permanently revoking this family member's access:" : "Reason for suspending this family member:");
    if (!reason) return;
    setBusy(memberId);
    try {
      const res = await fetch(`/api/admin/family/members/${memberId}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, permanent }) });
      if (res.ok) { show(permanent ? "Access revoked." : "Member suspended.", "success"); load(); }
      else show((await res.json()).error ?? "Could not update.", "error");
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="flex h-64 items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4 p-6">
      <Link href="/admin/family-accounts" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Family Accounts</Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">{data.familyCode}</h1>
        <p className="text-sm text-muted">Primary applicant: {data.applicant.fullName} ({data.applicant.profileCode})</p>
      </div>

      {data.members.map((m) => (
        <Card key={m.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{m.fullName} <span className="font-normal text-muted">({m.relationship})</span></span>
              <div className="flex items-center gap-2">
                <Badge variant={m.status === "ACTIVE" ? "success" : m.status === "SUSPENDED" ? "warning" : "muted"}>{formatEnumLabel(m.status)}</Badge>
                <Badge variant="muted">{formatEnumLabel(m.role.replace("FAMILY_", ""))}</Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-muted">{m.email} · {m.lastLoginAt ? `last login ${formatDateTime(m.lastLoginAt)}` : "never logged in"}</p>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Permissions</p>
              {m.permissions.filter((p) => p.status !== "REVOKED").length === 0 ? <p className="text-muted">None</p> : (
                <ul className="mt-1 space-y-1">
                  {m.permissions.filter((p) => p.status !== "REVOKED").map((p) => (
                    <li key={p.permission} className="flex items-center justify-between">
                      <span>{formatEnumLabel(p.permission.replace(/\./g, "_"))}</span>
                      <Badge variant={p.status === "ACTIVE" ? "success" : "muted"}>{formatEnumLabel(p.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Active Sessions</p>
              {m.sessions.length === 0 ? <p className="text-muted">None</p> : (
                <ul className="mt-1 space-y-1">
                  {m.sessions.map((s) => <li key={s.id}>{s.deviceInfo ?? "Unknown device"} — last active {formatDateTime(s.lastActiveAt)}</li>)}
                </ul>
              )}
            </div>

            {m.status === "ACTIVE" && (
              <div className="flex gap-2 border-t border-border pt-3">
                <Button size="sm" variant="outline" onClick={() => suspend(m.id, false)} disabled={busy === m.id}>Suspend</Button>
                <Button size="sm" variant="danger" onClick={() => suspend(m.id, true)} disabled={busy === m.id}><Ban className="h-4 w-4" /> Revoke Access</Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
