"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldCheck, ShieldQuestion, FileText, Flag as FlagIcon, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea, Input } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel, formatDate, formatDateTime } from "@/lib/utils";
import { CHECKLIST_CATEGORY_LABEL } from "@/lib/verification/checklist-catalog";

const REJECTION_CATEGORIES = [
  { value: "INFORMATION_INCOMPLETE", label: "Information incomplete" },
  { value: "INFORMATION_INCONSISTENT", label: "Information inconsistent" },
  { value: "VERIFICATION_FAILED", label: "Verification failed" },
  { value: "DUPLICATE_ACCOUNT_SUSPECTED", label: "Duplicate account suspected" },
  { value: "POLICY_VIOLATION", label: "Policy violation" },
  { value: "OTHER", label: "Other" },
];

const FLAG_TYPES = [
  "MULTIPLE_REGISTRATIONS",
  "REPEATED_FAILED_OTP",
  "UNUSUAL_UPDATE_ACTIVITY",
  "SUSPICIOUS_ACCOUNT_BEHAVIOR",
  "DUPLICATE_PROFILE_SUSPECTED",
  "VERIFICATION_INCONSISTENCY",
  "ABUSIVE_BEHAVIOR_REPORT",
];

interface ChecklistItem {
  key: string;
  category: string;
  label: string;
  requiresDocument: boolean;
  status: "PENDING" | "COMPLETED" | "FAILED" | "NOT_APPLICABLE";
  note: string | null;
  documentId: string | null;
}
interface DocumentItem {
  id: string;
  documentType: string;
  reviewStatus: string;
  uploadedAt: string;
  reviewNote: string | null;
  mimeType: string;
}
interface FlagItem {
  id: string;
  flagType: string;
  severity: string;
  status: string;
  description: string;
  assignedToName: string | null;
  relatedProfile: { id: string; fullName: string; profileCode: string } | null;
  createdAt: string;
}
interface NoteItem {
  id: string;
  text: string;
  createdAt: string;
  adminName: string;
}
interface CompletenessCategory {
  key: string;
  label: string;
  weight: number;
  earnedWeight: number;
  missingFields: string[];
}
interface Detail {
  profile: { id: string; fullName: string; profileCode: string; age: number; city: string; area: string | null; country: string; verified: boolean };
  profileStatus: string;
  registeredAt: string;
  verification: {
    id: string;
    status: string;
    assignedTo: { id: string; name: string } | null;
    phoneVerifiedAt: string | null;
    emailVerifiedAt: string | null;
    whatsappVerifiedAt: string | null;
    requestedInfoItems: string[];
    rejectionReasonCategory: string | null;
    rejectionNote: string | null;
    suspensionReason: string | null;
    reVerificationReason: string | null;
    lastReviewedAt: string | null;
    lastReviewedByName: string | null;
  };
  checklist: ChecklistItem[];
  documents: DocumentItem[];
  flags: FlagItem[];
  notes: NoteItem[];
  completeness: { percent: number; categories: CompletenessCategory[] };
  confidence: "HIGH" | "MEDIUM" | "LOW";
  documentVerificationEnabled: boolean;
}

const CONFIDENCE_VARIANT: Record<string, "success" | "warning" | "danger"> = { HIGH: "success", MEDIUM: "warning", LOW: "danger" };
const ITEM_STATUS_ICON: Record<string, typeof CheckCircle2> = { COMPLETED: CheckCircle2, FAILED: XCircle, NOT_APPLICABLE: MinusCircle, PENDING: MinusCircle };

export default function VerificationReviewPage({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = use(params);
  const { show } = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string; role: string; active?: boolean }[]>([]);
  const [assignTo, setAssignTo] = useState("");

  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const [showRequestInfo, setShowRequestInfo] = useState(false);
  const [requestItems, setRequestItems] = useState<string[]>([]);
  const [requestNote, setRequestNote] = useState("");

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCategory, setRejectCategory] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");

  const [reverifyOpen, setReverifyOpen] = useState(false);
  const [reverifyReason, setReverifyReason] = useState("");

  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagType, setFlagType] = useState(FLAG_TYPES[0]);
  const [flagSeverity, setFlagSeverity] = useState("MEDIUM");
  const [flagDescription, setFlagDescription] = useState("");

  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/admin/profiles/${profileId}/verification`)
      .then((r) => r.json())
      .then((json) => {
        setData(json);
        setAssignTo(json.verification.assignedTo?.id ?? "");
      });
  }

  useEffect(() => {
    load();
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((json) => setStaff((json.items ?? []).filter((a: { role: string; active?: boolean }) => a.role === "STAFF" && a.active !== false)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function callAction(body: Record<string, unknown>, successMsg: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/verification/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Action failed");
      }
      show(successMsg, "success");
      setRejectOpen(false);
      setSuspendOpen(false);
      setReverifyOpen(false);
      setShowRequestInfo(false);
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function updateChecklistItem(itemKey: string, status: string) {
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/verification/checklist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemKey, status }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      show("Could not update checklist item.", "error");
    }
  }

  async function addNote() {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newNote.trim() }),
      });
      if (!res.ok) throw new Error();
      setNewNote("");
      show("Note added", "success");
      load();
    } catch {
      show("Could not add note.", "error");
    } finally {
      setAddingNote(false);
    }
  }

  async function assignStaff() {
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/verification/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", assignedToId: assignTo || null }),
      });
      if (!res.ok) throw new Error();
      show("Assignment updated", "success");
      load();
    } catch {
      show("Could not assign.", "error");
    }
  }

  async function raiseFlag() {
    if (!flagDescription.trim()) return;
    try {
      const res = await fetch(`/api/admin/security-flags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, flagType, severity: flagSeverity, description: flagDescription.trim() }),
      });
      if (!res.ok) throw new Error();
      show("Flag raised", "success");
      setShowFlagForm(false);
      setFlagDescription("");
      load();
    } catch {
      show("Could not raise flag.", "error");
    }
  }

  function toggleRequestItem(key: string) {
    setRequestItems((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const grouped = Object.entries(CHECKLIST_CATEGORY_LABEL).map(([key, label]) => ({
    key,
    label,
    items: data.checklist.filter((c) => c.category === key),
  }));

  return (
    <div className="space-y-6">
      <Link href="/admin/verification" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Verification Center
      </Link>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
        {/* LEFT: Profile summary */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {data.profile.verified ? <ShieldCheck className="h-4 w-4 text-success" /> : <ShieldQuestion className="h-4 w-4 text-warning" />}
                {data.profile.fullName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <p className="text-xs text-muted">{data.profile.profileCode}</p>
              <p>Age: {data.profile.age}</p>
              <p>City: {[data.profile.area, data.profile.city].filter(Boolean).join(", ")}, {data.profile.country}</p>
              <p>Registered: {formatDate(data.registeredAt)}</p>
              <p className="flex items-center gap-1.5">Profile Status: <StatusBadge status={data.profileStatus} /></p>
              <p className="flex items-center gap-1.5">Verification: <StatusBadge status={data.verification.status} /></p>
              <Link href={`/admin/profiles/${data.profile.id}`} className="text-xs font-medium text-primary hover:underline">
                View Full Profile →
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile Completeness</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>Overall</span>
                <span>{data.completeness.percent}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-muted">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${data.completeness.percent}%` }} />
              </div>
              {data.completeness.categories.map((c) => (
                <div key={c.key} className="text-xs">
                  <div className="flex justify-between text-muted">
                    <span>{c.label}</span>
                    <span>{Math.round(c.earnedWeight)}/{c.weight}%</span>
                  </div>
                  {c.missingFields.length > 0 && <p className="text-muted">Missing: {c.missingFields.join(", ")}</p>}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verification Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={CONFIDENCE_VARIANT[data.confidence]}>{formatEnumLabel(data.confidence)}</Badge>
              <p className="mt-2 text-xs text-muted">
                An internal signal for admin review only — not a compatibility score, and never a claim of absolute authenticity.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* CENTER: Checklist */}
        <div className="space-y-4">
          {grouped.map((group) => (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle className="text-base">{group.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {group.items.map((item) => {
                  const Icon = ITEM_STATUS_ICON[item.status];
                  return (
                    <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
                      <span className="flex items-center gap-1.5">
                        <Icon className={`h-4 w-4 shrink-0 ${item.status === "COMPLETED" ? "text-success" : item.status === "FAILED" ? "text-danger" : "text-muted"}`} />
                        {item.label}
                        {item.documentId && (
                          <Link href={`/api/admin/verification-documents/${item.documentId}`} target="_blank" className="text-xs text-primary hover:underline">
                            <FileText className="inline h-3.5 w-3.5" /> View Document
                          </Link>
                        )}
                      </span>
                      <Select value={item.status} onChange={(e) => updateChecklistItem(item.key, e.target.value)} className="h-8 w-auto text-xs">
                        <option value="PENDING">Pending</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="FAILED">Failed</option>
                        <option value="NOT_APPLICABLE">Not Applicable</option>
                      </Select>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          {data.documentVerificationEnabled && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Submitted Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.documents.length === 0 && <p className="text-sm text-muted">No documents submitted.</p>}
                {data.documents.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5 text-sm">
                    <span>
                      {formatEnumLabel(d.documentType)} · Uploaded {formatDate(d.uploadedAt)}
                    </span>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={d.reviewStatus} />
                      <Link href={`/api/admin/verification-documents/${d.id}`} target="_blank" className="text-xs font-medium text-primary hover:underline">
                        View
                      </Link>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FlagIcon className="h-4 w-4 text-primary" /> Security Flags
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.flags.length === 0 && <p className="text-sm text-muted">No flags on this profile.</p>}
              {data.flags.map((f) => (
                <div key={f.id} className="rounded-lg border border-border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{formatEnumLabel(f.flagType)}</span>
                    <div className="flex gap-1.5">
                      <Badge variant={f.severity === "HIGH" || f.severity === "CRITICAL" ? "danger" : f.severity === "MEDIUM" ? "warning" : "muted"}>
                        {formatEnumLabel(f.severity)}
                      </Badge>
                      <StatusBadge status={f.status} />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">{f.description}</p>
                  {f.relatedProfile && (
                    <Link href={`/admin/profiles/${f.relatedProfile.id}`} className="text-xs text-primary hover:underline">
                      Related: {f.relatedProfile.fullName} ({f.relatedProfile.profileCode})
                    </Link>
                  )}
                </div>
              ))}
              {showFlagForm ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={flagType} onChange={(e) => setFlagType(e.target.value)}>
                      {FLAG_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {formatEnumLabel(t)}
                        </option>
                      ))}
                    </Select>
                    <Select value={flagSeverity} onChange={(e) => setFlagSeverity(e.target.value)}>
                      {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                        <option key={s} value={s}>
                          {formatEnumLabel(s)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Textarea rows={2} placeholder="Description" value={flagDescription} onChange={(e) => setFlagDescription(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={raiseFlag} disabled={!flagDescription.trim()}>
                      Raise Flag
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowFlagForm(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setShowFlagForm(true)}>
                  <FlagIcon className="h-4 w-4" /> Raise Flag
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Staff Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" className="w-full" onClick={assignStaff}>
                Assign
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button size="sm" className="w-full justify-start" onClick={() => callAction({ action: "approve" }, "Verification approved")} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" /> Approve Verification
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setShowRequestInfo(true)} disabled={busy}>
                Request More Information
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setRejectOpen(true)} disabled={busy}>
                Reject Verification
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setSuspendOpen(true)} disabled={busy}>
                Suspend Profile
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setReverifyOpen(true)} disabled={busy}>
                Require Re-Verification
              </Button>
            </CardContent>
          </Card>

          {showRequestInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Request More Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted">Select the items the applicant needs to address. They&apos;ll see these on My Verification.</p>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {data.checklist.map((item) => (
                    <label key={item.key} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={requestItems.includes(item.key)} onChange={() => toggleRequestItem(item.key)} />
                      {item.label}
                    </label>
                  ))}
                </div>
                <Textarea rows={2} placeholder="Note to include (optional)" value={requestNote} onChange={(e) => setRequestNote(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => callAction({ action: "request_more_info", items: requestItems, note: requestNote }, "Information requested")} disabled={requestItems.length === 0 || busy}>
                    Send Request
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowRequestInfo(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-surface-muted p-2 text-xs">
                  <p>{n.text}</p>
                  <p className="mt-1 text-muted">
                    {n.adminName} · {formatDateTime(n.createdAt)}
                  </p>
                </div>
              ))}
              <Textarea placeholder="Verification findings, follow-up needed…" value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={2} />
              <Button size="sm" className="w-full" onClick={addNote} disabled={!newNote.trim() || addingNote}>
                Add Note
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={rejectOpen}
        title="Reject Verification"
        description="The applicant will see a generic message that action is required. This reason and note stay internal."
        confirmLabel="Reject Verification"
        danger
        confirmDisabled={!rejectCategory || busy}
        onConfirm={() => callAction({ action: "reject", rejectionReasonCategory: rejectCategory, rejectionNote: rejectNote }, "Verification rejected")}
        onCancel={() => setRejectOpen(false)}
      >
        <Field label="Reason Category" htmlFor="rejectCategory">
          <Select id="rejectCategory" value={rejectCategory} onChange={(e) => setRejectCategory(e.target.value)}>
            <option value="">Select a reason…</option>
            {REJECTION_CATEGORIES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Internal Note (private)" htmlFor="rejectNote">
          <Textarea id="rejectNote" rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={suspendOpen}
        title="Suspend Profile"
        description="This removes the profile from the active matching pool and treats it as unverified until reinstated."
        confirmLabel="Suspend"
        danger
        confirmDisabled={busy}
        onConfirm={() => callAction({ action: "suspend", reason: suspendReason }, "Profile suspended")}
        onCancel={() => setSuspendOpen(false)}
      >
        <Field label="Reason (internal)" htmlFor="suspendReason">
          <Input id="suspendReason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={reverifyOpen}
        title="Require Re-Verification"
        description="The profile's verification status resets and may be temporarily removed from the matching pool, depending on the configured policy."
        confirmLabel="Require Re-Verification"
        confirmDisabled={busy}
        onConfirm={() => callAction({ action: "require_reverification", reason: reverifyReason }, "Re-verification required")}
        onCancel={() => setReverifyOpen(false)}
      >
        <Field label="Reason" htmlFor="reverifyReason">
          <Input id="reverifyReason" value={reverifyReason} onChange={(e) => setReverifyReason(e.target.value)} placeholder="e.g. Contact information changed" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
