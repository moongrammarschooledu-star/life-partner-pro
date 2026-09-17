"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck, FileText, Trash2, Archive, Lock, Download, AlertTriangle, ScrollText } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, formatEnumLabel } from "@/lib/utils";

interface Kpis {
  activeConsents: number;
  pendingPrivacyRequests: number;
  deletionRequests: number;
  exportRequests: number;
  retentionDue: number;
  legalHolds: number;
  privacyIncidents: number;
  restrictedProfiles: number;
}

const TABS = [
  { value: "requests", label: "Privacy Requests" },
  { value: "deletions", label: "Deletion Queue" },
  { value: "retention", label: "Retention Policies" },
  { value: "holds", label: "Data Holds" },
  { value: "exports", label: "Data Exports" },
  { value: "access-log", label: "Privacy Audit Log" },
];

const DATA_CATEGORIES = [
  "ACCOUNT_DATA", "PROFILE_DATA", "CONTACT_DATA", "PHOTOS", "VERIFICATION_DOCUMENTS",
  "CONSENT_RECORDS", "PROPOSAL_RECORDS", "MEETING_RECORDS", "COMMUNICATION_RECORDS",
  "SUPPORT_CASES", "SAFETY_CASES", "AUDIT_LOGS", "SECURITY_LOGS", "FINANCIAL_RECORDS",
];
const RETENTION_ACTIONS = ["DELETE", "ANONYMIZE", "ARCHIVE", "REVIEW_REQUIRED", "RETAIN"];

export default function PrivacyCenterPage() {
  const { show } = useToast();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [tab, setTab] = useState("requests");

  useEffect(() => {
    fetch("/api/admin/privacy-center/kpis").then((r) => r.json()).then(setKpis).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Privacy Center</h1>
        <p className="text-sm text-muted">Consent, privacy requests, retention, and data protection — centralized and audited.</p>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={ShieldCheck} label="Active Consents" value={kpis.activeConsents} />
          <StatCard icon={FileText} label="Pending Requests" value={kpis.pendingPrivacyRequests} accent={kpis.pendingPrivacyRequests > 0 ? "warning" : "success"} />
          <StatCard icon={Trash2} label="Deletion Requests" value={kpis.deletionRequests} />
          <StatCard icon={Download} label="Export Requests" value={kpis.exportRequests} />
          <StatCard icon={AlertTriangle} label="Retention Due" value={kpis.retentionDue} accent={kpis.retentionDue > 0 ? "warning" : "success"} />
          <StatCard icon={Lock} label="Legal Holds" value={kpis.legalHolds} />
          <StatCard icon={ShieldCheck} label="Privacy Incidents" value={kpis.privacyIncidents} accent={kpis.privacyIncidents > 0 ? "danger" : "success"} />
          <StatCard icon={ScrollText} label="Restricted Profiles" value={kpis.restrictedProfiles} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        <Link href="/admin/case-management?type=PRIVACY_INCIDENT" className="text-sm text-primary hover:underline">
          View Privacy Incidents in Case Management →
        </Link>
      </div>

      {tab === "requests" && <RequestsSection onChanged={() => show("Updated", "success")} />}
      {tab === "deletions" && <DeletionsSection onChanged={() => show("Updated", "success")} />}
      {tab === "retention" && <RetentionSection onChanged={() => show("Saved", "success")} />}
      {tab === "holds" && <HoldsSection onChanged={() => show("Updated", "success")} />}
      {tab === "exports" && <ExportsSection />}
      {tab === "access-log" && <AccessLogSection />}
    </div>
  );
}

function RequestsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; requestCode: string; type: string; status: string; description: string | null; profile: { fullName: string; profileCode: string }; submittedAt: string }> | null>(null);

  function load() {
    setItems(null);
    fetch("/api/admin/privacy-center/requests").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function resolve(id: string, status: string) {
    const res = await fetch(`/api/admin/privacy-center/requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      onChanged();
      load();
    }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={FileText} title="No privacy requests" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Request</th><th className="p-3">Profile</th><th className="p-3">Type</th><th className="p-3">Status</th><th className="p-3">Submitted</th><th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b border-border last:border-0">
              <td className="p-3 font-mono text-xs">{r.requestCode}</td>
              <td className="p-3">{r.profile.fullName} <span className="text-muted">({r.profile.profileCode})</span></td>
              <td className="p-3 text-muted">{formatEnumLabel(r.type)}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(r.status)}</Badge></td>
              <td className="p-3 text-muted">{formatDate(r.submittedAt)}</td>
              <td className="p-3 space-x-2">
                {["SUBMITTED", "UNDER_REVIEW"].includes(r.status) && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => resolve(r.id, "IN_PROGRESS")}>Start</Button>
                    <Button size="sm" variant="outline" onClick={() => resolve(r.id, "COMPLETED")}>Complete</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeletionsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; requestCode: string; status: string; mode: string | null; profile: { fullName: string; profileCode: string }; submittedAt: string; scheduledFor: string | null }> | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [mode, setMode] = useState("DELETE");
  const [rejectionReason, setRejectionReason] = useState("");

  function load() {
    setItems(null);
    fetch("/api/admin/privacy-center/deletion-requests").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function review(id: string, decision: "approve" | "reject") {
    const res = await fetch(`/api/admin/privacy-center/deletion-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, mode: decision === "approve" ? mode : undefined, rejectionReason: decision === "reject" ? rejectionReason : undefined }),
    });
    if (res.ok) {
      onChanged();
      setReviewing(null);
      setRejectionReason("");
      load();
    }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={Trash2} title="No deletion requests" />;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="p-3">Request</th><th className="p-3">Profile</th><th className="p-3">Status</th><th className="p-3">Scheduled</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="p-3 font-mono text-xs">{r.requestCode}</td>
                <td className="p-3">{r.profile.fullName} <span className="text-muted">({r.profile.profileCode})</span></td>
                <td className="p-3"><Badge variant="muted">{formatEnumLabel(r.status)}</Badge></td>
                <td className="p-3 text-muted">{r.scheduledFor ? formatDateTime(r.scheduledFor) : "—"}</td>
                <td className="p-3">
                  {["SUBMITTED", "UNDER_REVIEW"].includes(r.status) && (
                    <Button size="sm" variant="outline" onClick={() => setReviewing(r.id)}>Review</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!reviewing}
        title="Review Deletion Request"
        description="Approving schedules irreversible processing after a cooling-off period. Rejecting reverts the account to Active."
        confirmLabel="Approve"
        onConfirm={() => reviewing && review(reviewing, "approve")}
        onCancel={() => setReviewing(null)}
      >
        <Field label="Mode" htmlFor="dr-mode">
          <Select id="dr-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="DELETE">Delete (irreversibly scrub)</option>
            <option value="ANONYMIZE">Anonymize (remove identifying info only)</option>
          </Select>
        </Field>
        <p className="text-xs text-muted">To reject instead, enter a reason and use the button below.</p>
        <Field label="Rejection reason (optional)" htmlFor="dr-reject">
          <Textarea id="dr-reject" rows={2} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
        </Field>
        <Button variant="outline" className="w-full" onClick={() => reviewing && review(reviewing, "reject")}>Reject Instead</Button>
      </ConfirmDialog>
    </>
  );
}

function RetentionSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ category: string; retentionDays: number | null; action: string | null; isActive: boolean }> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [days, setDays] = useState("30");
  const [action, setAction] = useState("REVIEW_REQUIRED");

  function load() {
    fetch("/api/admin/privacy-center/retention-policies").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function save() {
    if (!editing) return;
    const res = await fetch("/api/admin/privacy-center/retention-policies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: editing, retentionDays: Number(days), action, isActive: true }),
    });
    if (res.ok) {
      onChanged();
      setEditing(null);
      load();
    }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="p-3">Category</th><th className="p-3">Retention Period</th><th className="p-3">Action</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.category} className="border-b border-border last:border-0">
                <td className="p-3">{formatEnumLabel(p.category)}</td>
                <td className="p-3 text-muted">{p.retentionDays != null ? `${p.retentionDays} days` : "Not configured"}</td>
                <td className="p-3 text-muted">{p.action ? formatEnumLabel(p.action) : "—"}</td>
                <td className="p-3"><Badge variant={p.isActive ? "success" : "muted"}>{p.isActive ? "Active" : "Disabled"}</Badge></td>
                <td className="p-3">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(p.category); setDays(String(p.retentionDays ?? 30)); setAction(p.action ?? "REVIEW_REQUIRED"); }}>
                    Configure
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!editing}
        title={`Configure Retention — ${editing ? formatEnumLabel(editing) : ""}`}
        description="No period is hard-coded — this is fully configurable per category."
        confirmLabel="Save"
        onConfirm={save}
        onCancel={() => setEditing(null)}
      >
        <Field label="Retention Period (days)" htmlFor="ret-days">
          <Input id="ret-days" type="number" min={0} value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Action" htmlFor="ret-action">
          <Select id="ret-action" value={action} onChange={(e) => setAction(e.target.value)}>
            {RETENTION_ACTIONS.map((a) => <option key={a} value={a}>{formatEnumLabel(a)}</option>)}
          </Select>
        </Field>
      </ConfirmDialog>
    </>
  );
}

function HoldsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; profileId: string | null; recordType: string | null; recordId: string | null; reason: string; placedAt: string; active: boolean }> | null>(null);
  const [creating, setCreating] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [reason, setReason] = useState("");

  function load() {
    fetch("/api/admin/privacy-center/holds").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function create() {
    const res = await fetch("/api/admin/privacy-center/holds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, reason }),
    });
    if (res.ok) {
      onChanged();
      setCreating(false);
      setProfileId("");
      setReason("");
      load();
    }
  }

  async function lift(id: string) {
    const res = await fetch(`/api/admin/privacy-center/holds/${id}`, { method: "DELETE" });
    if (res.ok) {
      onChanged();
      load();
    }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>Place Hold</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Lock} title="No data holds" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Target</th><th className="p-3">Reason</th><th className="p-3">Placed</th><th className="p-3">Status</th><th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{h.profileId ?? `${h.recordType}:${h.recordId}`}</td>
                  <td className="p-3">{h.reason}</td>
                  <td className="p-3 text-muted">{formatDate(h.placedAt)}</td>
                  <td className="p-3"><Badge variant={h.active ? "warning" : "muted"}>{h.active ? "Active" : "Released"}</Badge></td>
                  <td className="p-3">{h.active && <Button size="sm" variant="outline" onClick={() => lift(h.id)}>Release</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog open={creating} title="Place Legal/Administrative Hold" description="Blocks automated retention actions on this profile until released." confirmLabel="Place Hold" onConfirm={create} onCancel={() => setCreating(false)}>
        <Field label="Profile ID (cuid)" htmlFor="hold-profile">
          <Input id="hold-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="hold-reason">
          <Textarea id="hold-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function ExportsSection() {
  const [items, setItems] = useState<Array<{ id: string; profile: { fullName: string; profileCode: string }; format: string; status: string; requestedAt: string; expiresAt: string | null }> | null>(null);

  useEffect(() => {
    fetch("/api/admin/privacy-center/exports").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={Download} title="No data export requests" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Profile</th><th className="p-3">Format</th><th className="p-3">Status</th><th className="p-3">Requested</th><th className="p-3">Expires</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="p-3">{e.profile.fullName} <span className="text-muted">({e.profile.profileCode})</span></td>
              <td className="p-3 text-muted">{e.format}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(e.status)}</Badge></td>
              <td className="p-3 text-muted">{formatDateTime(e.requestedAt)}</td>
              <td className="p-3 text-muted">{e.expiresAt ? formatDateTime(e.expiresAt) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessLogSection() {
  const [items, setItems] = useState<Array<{ id: string; action: string; dataCategory: string; actorAdmin: { name: string } | null; targetProfileId: string | null; createdAt: string }> | null>(null);

  useEffect(() => {
    fetch("/api/admin/privacy-center/access-log").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={ScrollText} title="No access log entries yet" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Action</th><th className="p-3">Category</th><th className="p-3">Actor</th><th className="p-3">When</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-border last:border-0">
              <td className="p-3">{formatEnumLabel(a.action)}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(a.dataCategory)}</Badge></td>
              <td className="p-3 text-muted">{a.actorAdmin?.name ?? "System"}</td>
              <td className="p-3 text-muted">{formatDateTime(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
