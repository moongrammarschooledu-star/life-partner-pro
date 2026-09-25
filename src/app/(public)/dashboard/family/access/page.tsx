"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

const PERMISSIONS = [
  "profile.basic.view", "profile.education.view", "profile.career.view", "profile.family.view", "profile.lifestyle.view",
  "profile.requirements.view", "profile.edit.suggest", "proposal.view", "proposal.comment", "proposal.respond",
  "meeting.view", "meeting.comment", "meeting.confirm", "meeting.reschedule", "communication.view", "communication.respond",
];
const SENSITIVE = new Set(["profile.family.view"]);

interface Permission { permission: string; scope: string | null; status: string; grantedAt: string; expiresAt: string | null; }
interface Member { id: string; fullName: string; relationship: string; role: string; status: string; permissions: Permission[]; }

export default function FamilyAccessPage() {
  const { show } = useToast();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [pickPermission, setPickPermission] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/my-family/access").then((r) => (r.ok ? r.json() : null)).then((j) => setMembers(j?.items ?? []));
  }
  useEffect(load, []);

  async function grant(memberId: string) {
    const permission = pickPermission[memberId];
    if (!permission) return;
    setBusy(memberId);
    try {
      const res = await fetch(`/api/my-family/members/${memberId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grantPermission: permission }) });
      if (res.ok) {
        show(SENSITIVE.has(permission) ? "Requires admin approval before it activates." : "Permission granted.", "success");
        load();
      } else show((await res.json()).error ?? "Could not grant permission.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(memberId: string, permission: string) {
    setBusy(memberId);
    try {
      const res = await fetch(`/api/my-family/members/${memberId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revokePermission: permission }) });
      if (res.ok) { show("Permission revoked.", "success"); load(); }
    } finally {
      setBusy(null);
    }
  }

  if (members === null) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/family" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Family Interaction</Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold">Family Access</h1>
        <p className="mt-1 text-sm text-muted">
          Exactly what each family member can see and do. A permission alone never grants visibility into a specific
          proposal or meeting — you also choose what to share from each proposal&apos;s page.
        </p>
      </div>

      {members.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted">No family members yet. <Link href="/dashboard/family/members" className="text-primary hover:underline">Invite one</Link>.</CardContent></Card>
      ) : (
        members.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{m.fullName} <span className="font-normal text-muted">({m.relationship})</span></span>
                <Badge variant={m.status === "ACTIVE" ? "success" : "muted"}>{formatEnumLabel(m.role.replace("FAMILY_", ""))}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {m.permissions.filter((p) => p.status !== "REVOKED" && p.status !== "REJECTED").length === 0 ? (
                <p className="text-sm text-muted">No permissions granted yet.</p>
              ) : (
                <div className="space-y-2">
                  {m.permissions.filter((p) => p.status !== "REVOKED" && p.status !== "REJECTED").map((p) => (
                    <div key={p.permission} className="flex items-center justify-between text-sm">
                      <span>{formatEnumLabel(p.permission.replace(/\./g, "_"))}{SENSITIVE.has(p.permission) ? " (sensitive)" : ""}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={p.status === "ACTIVE" ? "success" : "muted"}>{formatEnumLabel(p.status)}</Badge>
                        {p.expiresAt && <span className="text-xs text-muted">until {formatDateTime(p.expiresAt)}</span>}
                        <button onClick={() => revoke(m.id, p.permission)} disabled={busy === m.id} title="Revoke" className="text-muted hover:text-danger"><X className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <Select value={pickPermission[m.id] ?? ""} onChange={(e) => setPickPermission({ ...pickPermission, [m.id]: e.target.value })} className="w-64">
                  <option value="">Add a permission…</option>
                  {PERMISSIONS.map((p) => <option key={p} value={p}>{formatEnumLabel(p.replace(/\./g, "_"))}{SENSITIVE.has(p) ? " (sensitive)" : ""}</option>)}
                </Select>
                <Button size="sm" variant="outline" onClick={() => grant(m.id)} disabled={!pickPermission[m.id] || busy === m.id}>
                  <Plus className="h-4 w-4" /> Grant
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
