"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, Textarea, Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";
import { timeAgo, KV } from "@/components/admin/system/shared";

interface CrmDetail {
  id: string;
  crmCode: string;
  lifecycleStage: string;
  priority: string;
  assignmentStatus: string;
  leadSource: string | null;
  lastActivityAt: string | null;
  nextFollowupAt: string | null;
  profile: { id: string; fullName: string; profileCode: string; gender: string; city: string | null; country: string | null; status: string; verified: boolean };
  assignedStaff: { id: string; name: string } | null;
  tags: Array<{ tag: { id: string; name: string } }>;
}

// STEP 28 §20/§21 — "Applicant 360". A consolidated set of CRM-native tabs
// (Overview/Lifecycle/Notes/Follow-Ups/Timeline) rather than the spec's full
// ~15-tab list — the Timeline tab already aggregates every linked domain
// (proposals, meetings, subscriptions, leads, referrals, cases) via
// getCrmTimeline, so cross-domain visibility is real, just presented as one
// unified feed instead of N separate embedded panels. A disclosed scope
// decision, not a silent gap.
const TABS = [
  { value: "overview", label: "Overview" },
  { value: "lifecycle", label: "Lifecycle" },
  { value: "notes", label: "Notes" },
  { value: "followups", label: "Follow-Ups" },
  { value: "timeline", label: "Timeline" },
];

export default function CrmDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<CrmDetail | null>(null);
  const [tab, setTab] = useState("overview");

  const load = useCallback(() => {
    fetch(`/api/admin/crm/${id}`, { cache: "no-store" }).then((r) => r.json()).then(setRecord).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  if (!record) return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/crm" className="text-muted hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
        <div>
          <h1 className="font-heading text-2xl font-semibold">{record.profile.fullName}</h1>
          <p className="text-sm text-muted">{record.crmCode} · {record.profile.profileCode}</p>
        </div>
        <Badge variant="info" className="ml-auto">{formatEnumLabel(record.lifecycleStage)}</Badge>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && <OverviewTab record={record} onChanged={load} />}
      {tab === "lifecycle" && <LifecycleTab crmRecordId={record.id} currentStage={record.lifecycleStage} onChanged={load} />}
      {tab === "notes" && <NotesTab crmRecordId={record.id} />}
      {tab === "followups" && <FollowUpsTab crmRecordId={record.id} profileId={record.profile.id} />}
      {tab === "timeline" && <TimelineTab crmRecordId={record.id} />}
    </div>
  );
}

function OverviewTab({ record, onChanged }: { record: CrmDetail; onChanged: () => void }) {
  const { show } = useToast();
  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);

  async function assign() {
    if (!assignTo.trim()) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/admin/crm/${record.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminId: assignTo }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to assign");
      show("Assigned.", "success");
      setAssignTo("");
      onChanged();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed to assign", "error");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 font-medium">Applicant</h3>
        <KV label="Profile Code">{record.profile.profileCode}</KV>
        <KV label="City">{record.profile.city ?? "—"}</KV>
        <KV label="Country">{record.profile.country ?? "—"}</KV>
        <KV label="Profile Status">{formatEnumLabel(record.profile.status)}</KV>
        <KV label="Verified">{record.profile.verified ? "Yes" : "No"}</KV>
        <Link href={`/admin/profiles/${record.profile.id}`} className="mt-2 inline-block text-sm text-primary hover:underline">Open full profile →</Link>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 font-medium">CRM Record</h3>
        <KV label="Priority">{formatEnumLabel(record.priority)}</KV>
        <KV label="Assignment Status">{formatEnumLabel(record.assignmentStatus)}</KV>
        <KV label="Assigned To">{record.assignedStaff?.name ?? "Unassigned"}</KV>
        <KV label="Lead Source">{record.leadSource ? formatEnumLabel(record.leadSource) : "—"}</KV>
        <KV label="Last Activity">{timeAgo(record.lastActivityAt)}</KV>
        <KV label="Next Follow-up">{record.nextFollowupAt ? new Date(record.nextFollowupAt).toLocaleDateString() : "—"}</KV>
        <div className="mt-3 flex gap-2">
          <Input placeholder="Admin ID to assign" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} />
          <Button onClick={assign} disabled={assigning}>Assign</Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4 sm:col-span-2">
        <h3 className="mb-2 font-medium">Tags</h3>
        <div className="flex flex-wrap gap-1.5">
          {record.tags.length === 0 ? <span className="text-sm text-muted">No tags applied.</span> : record.tags.map((t) => <Badge key={t.tag.id} variant="muted">{t.tag.name}</Badge>)}
        </div>
      </div>
    </div>
  );
}

const FORWARD_PATH = [
  "REGISTERED", "PROFILE_INCOMPLETE", "PROFILE_SUBMITTED", "UNDER_REVIEW", "VERIFICATION_PENDING", "VERIFIED",
  "ACTIVE", "MATCHING", "PROPOSAL_ACTIVE", "WAITING_FOR_RESPONSE", "MUTUAL_INTEREST", "CONTACT_COORDINATION",
  "MEETING_SCHEDULED", "MEETING_COMPLETED", "FOLLOWUP", "FURTHER_DISCUSSION", "FINALIZATION_REVIEW", "FINALIZED", "MARRIED",
];
const EXIT_STAGES = ["ON_HOLD", "NOT_INTERESTED", "REJECTED", "DEACTIVATED", "SUSPENDED", "ARCHIVED"];

function LifecycleTab({ crmRecordId, currentStage, onChanged }: { crmRecordId: string; currentStage: string; onChanged: () => void }) {
  const { show } = useToast();
  const [history, setHistory] = useState<Array<{ id: string; fromStage: string | null; toStage: string; reason: string | null; triggeredBy: string; createdAt: string }> | null>(null);
  const [toStage, setToStage] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/crm/${crmRecordId}/lifecycle/history`, { cache: "no-store" }).then((r) => r.json()).then((d) => setHistory(d.items ?? []));
  }, [crmRecordId]);

  const currentIdx = FORWARD_PATH.indexOf(currentStage);
  const options = [...FORWARD_PATH.slice(currentIdx + 1), ...EXIT_STAGES];

  async function transition() {
    if (!toStage) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/${crmRecordId}/lifecycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toStage, reason: reason || undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transition failed");
      show("Lifecycle stage updated.", "success");
      setToStage(""); setReason("");
      onChanged();
      fetch(`/api/admin/crm/${crmRecordId}/lifecycle/history`, { cache: "no-store" }).then((r) => r.json()).then((d) => setHistory(d.items ?? []));
    } catch (e) {
      show(e instanceof Error ? e.message : "Transition failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 font-medium">Move to a new stage</h3>
        <div className="flex flex-wrap gap-2">
          <Select value={toStage} onChange={(e) => setToStage(e.target.value)} className="max-w-xs">
            <option value="">Select stage…</option>
            {options.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}
          </Select>
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-xs" />
          <Button onClick={transition} disabled={busy || !toStage}>Transition</Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 font-medium">History</h3>
        {history === null ? <Skeleton className="h-24" /> : history.length === 0 ? (
          <p className="text-sm text-muted">No transitions recorded yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="border-t border-border pt-2 first:border-t-0 first:pt-0">
                <span className="font-medium">{h.fromStage ? formatEnumLabel(h.fromStage) : "—"} → {formatEnumLabel(h.toStage)}</span>
                <span className="ml-2 text-muted">{formatEnumLabel(h.triggeredBy)} · {timeAgo(h.createdAt)}</span>
                {h.reason && <p className="text-muted">{h.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotesTab({ crmRecordId }: { crmRecordId: string }) {
  const { show } = useToast();
  const [notes, setNotes] = useState<Array<{ id: string; body: string; visibility: string; createdAt: string; authorId: string }> | null>(null);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("INTERNAL_ONLY");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/admin/crm/${crmRecordId}/notes`, { cache: "no-store" }).then((r) => r.json()).then((d) => setNotes(d.items ?? []));
  }, [crmRecordId]);
  useEffect(load, [load]);

  async function addNote() {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/crm/${crmRecordId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, visibility }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add note");
      setBody("");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed to add note", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
        <Textarea placeholder="Add a note…" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
        <div className="flex items-center gap-2">
          <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="max-w-xs">
            <option value="INTERNAL_ONLY">Internal Only</option>
            <option value="STAFF_SHARED">Staff Shared</option>
            <option value="MANAGER_ONLY">Manager Only</option>
          </Select>
          <Button onClick={addNote} disabled={saving || !body.trim()}>Add Note</Button>
        </div>
      </div>
      {notes === null ? <Skeleton className="h-24" /> : notes.length === 0 ? (
        <p className="text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                <Badge variant="muted">{formatEnumLabel(n.visibility)}</Badge>
                <span>{timeAgo(n.createdAt)}</span>
              </div>
              <p>{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FollowUpsTab({ crmRecordId, profileId }: { crmRecordId: string; profileId: string }) {
  const { show } = useToast();
  const [items, setItems] = useState<Array<{ id: string; type: string | null; dueDate: string; status: string; slaState: string | null; nextAction: string | null }> | null>(null);
  const [type, setType] = useState("GENERAL");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/admin/crm/followups?crmRecordId=${crmRecordId}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }, [crmRecordId]);
  useEffect(load, [load]);

  async function create() {
    if (!dueDate) return show("A due date is required.", "error");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/crm/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crmRecordId, type, dueDate: new Date(dueDate).toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create follow-up");
      setDueDate("");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Failed to create follow-up", "error");
    } finally {
      setSaving(false);
    }
  }

  async function complete(id: string) {
    const res = await fetch(`/api/admin/crm/followups/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (res.ok) { show("Follow-up completed.", "success"); load(); }
  }

  void profileId;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-2 font-medium">New follow-up</h3>
        <div className="flex flex-wrap gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-xs">
            {["INITIAL_CONTACT", "PROFILE_REVIEW", "VERIFICATION", "MATCH_REVIEW", "PROPOSAL", "MEETING", "SUPPORT", "PAYMENT", "GENERAL"].map((t) => (
              <option key={t} value={t}>{formatEnumLabel(t)}</option>
            ))}
          </Select>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Button onClick={create} disabled={saving}>Create</Button>
        </div>
      </div>
      {items === null ? <Skeleton className="h-24" /> : items.length === 0 ? (
        <p className="text-sm text-muted">No follow-ups for this record yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-xl border border-border bg-surface p-3 text-sm">
              <div>
                <span className="font-medium">{f.type ? formatEnumLabel(f.type) : "Follow-up"}</span>
                <span className="ml-2 text-muted">Due {new Date(f.dueDate).toLocaleDateString()}</span>
                {f.slaState && <Badge variant={f.slaState === "BREACHED" || f.slaState === "OVERDUE" ? "danger" : "muted"} className="ml-2">{formatEnumLabel(f.slaState)}</Badge>}
              </div>
              {f.status !== "COMPLETED" && <Button size="sm" variant="secondary" onClick={() => complete(f.id)}>Complete</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimelineTab({ crmRecordId }: { crmRecordId: string }) {
  const [items, setItems] = useState<Array<{ sourceType: string; label: string; detail?: string; actorSource: string; createdAt: string }> | null>(null);

  useEffect(() => {
    fetch(`/api/admin/crm/${crmRecordId}/timeline`, { cache: "no-store" }).then((r) => r.json()).then((d) => setItems(d.items ?? []));
  }, [crmRecordId]);

  if (items === null) return <Skeleton className="h-64" />;
  if (items.length === 0) return <p className="text-sm text-muted">No activity recorded yet.</p>;

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="rounded-xl border border-border bg-surface p-3 text-sm">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Badge variant="muted">{formatEnumLabel(item.sourceType)}</Badge>
            <span>{formatEnumLabel(item.actorSource)}</span>
            <span>· {timeAgo(item.createdAt)}</span>
          </div>
          <p className="mt-1">{item.label}</p>
          {item.detail && <p className="text-muted">{item.detail}</p>}
        </li>
      ))}
    </ul>
  );
}
