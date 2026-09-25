"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft, Send, RotateCw, Ban, PauseCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

const ROLES = ["FAMILY_VIEWER", "FAMILY_ADVISOR", "FAMILY_COORDINATOR", "FAMILY_GUARDIAN", "FAMILY_APPROVER", "FAMILY_ADMIN"];
const ROLE_DESCRIPTIONS: Record<string, string> = {
  FAMILY_VIEWER: "Read-only access to approved basic information.",
  FAMILY_ADVISOR: "Can view and comment/suggest.",
  FAMILY_COORDINATOR: "Can help manage approved proposal/meeting workflows.",
  FAMILY_GUARDIAN: "Can perform explicitly delegated actions, including suggesting proposal responses.",
  FAMILY_APPROVER: "Can participate in specific delegated decisions.",
  FAMILY_ADMIN: "Manages your family's own members only — never platform admin access.",
};

interface Invitation { id: string; invitationCode: string; invitedName: string; invitedEmail: string | null; relationship: string; requestedRole: string; status: string; expiresAt: string; }
interface Member { id: string; fullName: string; relationship: string; role: string; status: string; email: string | null; joinedAt: string | null; lastLoginAt: string | null; }

export default function FamilyMembersPage() {
  const { show } = useToast();
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [form, setForm] = useState({ invitedName: "", invitedEmail: "", relationship: "Parent", requestedRole: "FAMILY_VIEWER" });
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/my-family/invitations").then((r) => (r.ok ? r.json() : null)).then((j) => setInvitations(j?.items ?? []));
    fetch("/api/my-family/members").then((r) => (r.ok ? r.json() : null)).then((j) => setMembers(j?.items ?? []));
  }
  useEffect(load, []);

  async function invite() {
    if (!form.invitedName.trim() || !form.invitedEmail.trim() || !form.relationship.trim()) {
      show("Name, email, and relationship are required.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/my-family/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Could not send invitation.", "error"); return; }
      show(`Invitation sent — ${json.invitationCode}`, "success");
      setForm({ invitedName: "", invitedEmail: "", relationship: "Parent", requestedRole: "FAMILY_VIEWER" });
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function resend(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/my-family/invitations/${id}/resend`, { method: "POST" });
      if (res.ok) { show("Invitation resent.", "success"); load(); }
      else show((await res.json()).error ?? "Could not resend.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeInvite(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/my-family/invitations/${id}/revoke`, { method: "POST" });
      if (res.ok) { show("Invitation revoked.", "success"); load(); }
    } finally {
      setBusyId(null);
    }
  }

  async function revokeMember(id: string) {
    if (!confirm("Remove this family member's access? This cannot be undone.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/my-family/members/${id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) { show("Access removed.", "success"); load(); }
    } finally {
      setBusyId(null);
    }
  }

  async function suspendMember(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/my-family/members/${id}/suspend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) { show("Member suspended.", "success"); load(); }
    } finally {
      setBusyId(null);
    }
  }

  if (invitations === null || members === null) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="space-y-4">
      <Link href="/dashboard/family" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Family Interaction</Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold">Family Members</h1>
        <p className="mt-1 text-sm text-muted">Invite trusted family members to assist with your matrimonial process. Access is optional, explicit, scoped, and revocable at any time.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Invite a Family Member</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="invitedName"><Input id="invitedName" value={form.invitedName} onChange={(e) => setForm({ ...form, invitedName: e.target.value })} /></Field>
          <Field label="Email" htmlFor="invitedEmail"><Input id="invitedEmail" type="email" value={form.invitedEmail} onChange={(e) => setForm({ ...form, invitedEmail: e.target.value })} /></Field>
          <Field label="Relationship" htmlFor="relationship">
            <Select id="relationship" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
              {["Parent", "Guardian", "Sibling", "Relative", "Other"].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Access Level" htmlFor="requestedRole" hint={ROLE_DESCRIPTIONS[form.requestedRole]}>
            <Select id="requestedRole" value={form.requestedRole} onChange={(e) => setForm({ ...form, requestedRole: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{formatEnumLabel(r.replace("FAMILY_", ""))}</option>)}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button onClick={invite} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Invitation</Button>
          </div>
        </CardContent>
      </Card>

      {members.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Family Members</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {members.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">{m.fullName} <span className="text-muted">({m.relationship})</span></p>
                  <p className="text-xs text-muted">{formatEnumLabel(m.role.replace("FAMILY_", ""))} · {m.lastLoginAt ? `Last active ${formatDateTime(m.lastLoginAt)}` : "Never logged in"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={m.status === "ACTIVE" ? "success" : m.status === "SUSPENDED" ? "warning" : "muted"}>{formatEnumLabel(m.status)}</Badge>
                  {m.status === "ACTIVE" && (
                    <>
                      <button title="Suspend" onClick={() => suspendMember(m.id)} disabled={busyId === m.id} className="text-muted hover:text-warning"><PauseCircle className="h-4 w-4" /></button>
                      <button title="Remove access" onClick={() => revokeMember(m.id)} disabled={busyId === m.id} className="text-muted hover:text-danger"><Ban className="h-4 w-4" /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {invitations.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Pending Invitations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {invitations.filter((i) => i.status !== "ACCEPTED").map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">{inv.invitedName} <span className="text-muted">({inv.relationship})</span></p>
                  <p className="text-xs text-muted">{inv.invitedEmail} · Expires {formatDateTime(inv.expiresAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">{formatEnumLabel(inv.status)}</Badge>
                  {(inv.status === "SENT" || inv.status === "EXPIRED") && (
                    <button title="Resend" onClick={() => resend(inv.id)} disabled={busyId === inv.id} className="text-muted hover:text-primary"><RotateCw className="h-4 w-4" /></button>
                  )}
                  {inv.status !== "REVOKED" && (
                    <button title="Revoke" onClick={() => revokeInvite(inv.id)} disabled={busyId === inv.id} className="text-muted hover:text-danger"><Ban className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
