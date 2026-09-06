"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Share2,
  ShieldCheck,
  AlertTriangle,
  CalendarPlus,
  Users,
  StickyNote,
  Bell,
  Ban,
  ThumbsDown,
  CheckCircle2,
  Heart,
  Archive,
  UserCog,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea, Input, Checkbox } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Timeline } from "@/components/ui/timeline";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel, formatDate, formatDateTime, formatCurrency, formatHeight } from "@/lib/utils";
import { CompatibilityBreakdownList } from "@/components/admin/compatibility-breakdown";
import { SELECTABLE_STATUSES, ADMIN_STATUS_LABEL, isLegacyStatus } from "@/lib/proposal-status-labels";
import type { ProfileDetailDto } from "@/lib/serializers";
import type { CompatibilityRow } from "@/components/admin/compatibility-breakdown";

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { HIGH: "danger", MEDIUM: "warning", LOW: "muted" };
const DECLINE_REASONS = ["DIFFERENT_EXPECTATIONS", "LOCATION", "AGE", "EDUCATION", "PROFESSION", "FAMILY_PREFERENCE", "PERSONAL_PREFERENCE", "OTHER"];
const MEETING_TYPES = ["FAMILY_MEETING", "INITIAL_MEETING", "ONLINE_MEETING", "PHONE_DISCUSSION", "IN_PERSON_MEETING", "OTHER"];

interface ResponseRow {
  id: string;
  profileId: string;
  response: "INTERESTED" | "NOT_INTERESTED" | "NEED_MORE_INFO";
  reason: string | null;
  reasonNote: string | null;
  respondedAt: string;
  profile: { id: string; fullName: string };
}
interface ContactPermissionRow {
  id: string;
  profileId: string;
  requestedAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
  profile: { id: string; fullName: string };
  approvedBy: { name: string } | null;
}
interface MeetingRow {
  id: string;
  meetingType: string;
  scheduledAt: string;
  locationInfo: string | null;
  participants: string | null;
  status: string;
  notes: string | null;
}
interface FamilyCommRow {
  id: string;
  profileId: string;
  contactPerson: string;
  relationship: string;
  communicationMethod: string;
  communicationDate: string;
  outcome: string | null;
  notes: string | null;
}
interface EventRow {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
  performedByAdmin: { name: string } | null;
  performedByProfile: { fullName: string } | null;
}
interface NoteRow {
  id: string;
  text: string;
  createdAt: string;
  admin: { name: string };
}

interface ProposalDetail {
  id: string;
  proposalCode: string;
  status: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  matchScore: number | null;
  createdAt: string;
  finalizedAt: string | null;
  finalNotes: string | null;
  marriedAt: string | null;
  marriageNotes: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  internalRejectionNote: string | null;
  archivedAt: string | null;
  profileA: ProfileDetailDto;
  profileB: ProfileDetailDto;
  profileAId: string;
  profileBId: string;
  createdBy: { id: string; name: string } | null;
  assignedTo: { id: string; name: string } | null;
  breakdown: CompatibilityRow[] | null;
  events: EventRow[];
  responses: ResponseRow[];
  contactPermissions: ContactPermissionRow[];
  meetings: MeetingRow[];
  familyCommunications: FamilyCommRow[];
  notes: NoteRow[];
}

function ProfileSummary({ profile, title }: { profile: ProfileDetailDto; title: string }) {
  return (
    <div className="flex-1 space-y-1.5 text-sm">
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <Link href={`/admin/profiles/${profile.id}`} className="text-base font-semibold text-primary hover:underline">
        {profile.fullName}
      </Link>
      <p className="text-xs text-muted">
        {profile.profileCode} {profile.verified && <ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-success" />}
      </p>
      <p>
        {profile.age} years · {formatHeight(profile.heightCm)}
      </p>
      <p>
        {[profile.area, profile.city].filter(Boolean).join(", ")}, {profile.country}
      </p>
      <p>{profile.education?.level ?? "—"}</p>
      <p>{profile.profession?.profession ?? "—"}</p>
      <p>{formatCurrency(profile.profession?.monthlyIncome)}</p>
    </div>
  );
}

export default function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string; role: string }[]>([]);

  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [priority, setPriority] = useState("MEDIUM");

  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const [sharePhone, setSharePhone] = useState(false);
  const [shareWhatsapp, setShareWhatsapp] = useState(false);
  const [shareEmail, setShareEmail] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);

  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [meetingType, setMeetingType] = useState("INITIAL_MEETING");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [meetingParticipants, setMeetingParticipants] = useState("");
  const [schedulingMeeting, setSchedulingMeeting] = useState(false);

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [famProfileId, setFamProfileId] = useState("");
  const [famContactPerson, setFamContactPerson] = useState("");
  const [famRelationship, setFamRelationship] = useState("");
  const [famMethod, setFamMethod] = useState("Phone");
  const [famDate, setFamDate] = useState("");
  const [famOutcome, setFamOutcome] = useState("");
  const [famNotes, setFamNotes] = useState("");
  const [loggingFamily, setLoggingFamily] = useState(false);

  const [showFollowUpForm, setShowFollowUpForm] = useState(false);
  const [followUpProfileId, setFollowUpProfileId] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpPurpose, setFollowUpPurpose] = useState("");
  const [addingFollowUp, setAddingFollowUp] = useState(false);

  const [assignTo, setAssignTo] = useState("");
  const [assigning, setAssigning] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [marriedOpen, setMarriedOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [dangerBusy, setDangerBusy] = useState(false);

  function load() {
    fetch(`/api/admin/proposals/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setProposal(data);
        setStatus(data.status);
        setPriority(data.priority);
        setFollowUpProfileId(data.profileAId);
        setFamProfileId(data.profileAId);
        setAssignTo(data.assignedTo?.id ?? "");
      });
  }

  useEffect(() => {
    load();
    fetch("/api/admin/admin-users")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setStaff((data.items ?? []).filter((a: { role: string; active?: boolean }) => a.role === "STAFF" && a.active !== false)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function patchProposal(body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || "Request failed");
    }
    return res.json();
  }

  async function updateStatus() {
    setSaving(true);
    try {
      await patchProposal({ status, note: note || undefined });
      show("Proposal updated", "success");
      setNote("");
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Could not update proposal.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function savePriority() {
    setSaving(true);
    try {
      await patchProposal({ priority });
      show("Priority updated", "success");
      load();
    } catch {
      show("Could not update priority.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function runDangerAction(body: Record<string, unknown>, successMsg: string) {
    setDangerBusy(true);
    try {
      await patchProposal(body);
      show(successMsg, "success");
      setRejectOpen(false);
      setFinalizeOpen(false);
      setMarriedOpen(false);
      setArchiveOpen(false);
      load();
    } catch (e) {
      show(e instanceof Error ? e.message : "Action failed.", "error");
    } finally {
      setDangerBusy(false);
    }
  }

  async function addNote() {
    if (!proposal || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/admin/profiles/${proposal.profileAId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newNote.trim(), proposalId: id }),
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

  async function shareContact() {
    if (!proposal || !consentGiven || (!sharePhone && !shareWhatsapp && !shareEmail)) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/admin/profiles/${proposal.profileAId}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otherProfileId: proposal.profileBId, phoneShared: sharePhone, whatsappShared: shareWhatsapp, emailShared: shareEmail }),
      });
      if (!res.ok) throw new Error();
      setShared(true);
      show("Contact details shared and recorded in the audit log", "success");
    } catch {
      show("Could not share contact details.", "error");
    } finally {
      setSharing(false);
    }
  }

  async function contactPermissionAction(profileId: string, action: "request" | "approve" | "revoke") {
    try {
      const res = await fetch(`/api/admin/proposals/${id}/contact-permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, action }),
      });
      if (!res.ok) throw new Error();
      show("Contact permission updated", "success");
      load();
    } catch {
      show("Could not update contact permission.", "error");
    }
  }

  async function scheduleMeeting() {
    if (!meetingDate) return;
    setSchedulingMeeting(true);
    try {
      const res = await fetch(`/api/admin/proposals/${id}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingType, scheduledAt: new Date(meetingDate).toISOString(), locationInfo: meetingLocation, participants: meetingParticipants }),
      });
      if (!res.ok) throw new Error();
      show("Meeting scheduled", "success");
      setShowMeetingForm(false);
      setMeetingDate("");
      setMeetingLocation("");
      setMeetingParticipants("");
      load();
    } catch {
      show("Could not schedule meeting.", "error");
    } finally {
      setSchedulingMeeting(false);
    }
  }

  async function recordResponse(profileId: string, response: "INTERESTED" | "NOT_INTERESTED" | "NEED_MORE_INFO") {
    try {
      const res = await fetch(`/api/admin/proposals/${id}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, response }),
      });
      if (!res.ok) throw new Error();
      show("Response recorded", "success");
      load();
    } catch {
      show("Could not record response.", "error");
    }
  }

  async function updateMeetingStatus(meetingId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/admin/proposals/${id}/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      show("Could not update meeting.", "error");
    }
  }

  async function logFamilyCommunication() {
    if (!famProfileId || !famContactPerson || !famRelationship || !famDate) return;
    setLoggingFamily(true);
    try {
      const res = await fetch(`/api/admin/proposals/${id}/family-communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: famProfileId,
          contactPerson: famContactPerson,
          relationship: famRelationship,
          communicationMethod: famMethod,
          communicationDate: new Date(famDate).toISOString(),
          outcome: famOutcome,
          notes: famNotes,
        }),
      });
      if (!res.ok) throw new Error();
      show("Family communication logged", "success");
      setShowFamilyForm(false);
      setFamContactPerson("");
      setFamRelationship("");
      setFamOutcome("");
      setFamNotes("");
      load();
    } catch {
      show("Could not log family communication.", "error");
    } finally {
      setLoggingFamily(false);
    }
  }

  async function addFollowUp() {
    if (!followUpProfileId || !followUpDate) return;
    setAddingFollowUp(true);
    try {
      const res = await fetch(`/api/admin/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: followUpProfileId, proposalId: id, dueDate: followUpDate, purpose: followUpPurpose }),
      });
      if (!res.ok) throw new Error();
      show("Follow-up added", "success");
      setShowFollowUpForm(false);
      setFollowUpPurpose("");
      load();
    } catch {
      show("Could not add follow-up.", "error");
    } finally {
      setAddingFollowUp(false);
    }
  }

  async function assignStaff() {
    setAssigning(true);
    try {
      const res = await fetch(`/api/admin/proposals/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToId: assignTo || null }),
      });
      if (!res.ok) throw new Error();
      show("Assignment updated", "success");
      load();
    } catch {
      show("Could not assign proposal.", "error");
    } finally {
      setAssigning(false);
    }
  }

  const [sendMessageOpen, setSendMessageOpen] = useState(false);
  const [sendMessageProfileId, setSendMessageProfileId] = useState("");
  const [sendMessageChannel, setSendMessageChannel] = useState("EMAIL");
  const [sendMessageText, setSendMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  function openSendMessage() {
    setSendMessageProfileId(proposal?.profileA.id ?? "");
    setSendMessageChannel("EMAIL");
    setSendMessageText("");
    setSendMessageOpen(true);
  }

  async function sendMessage() {
    if (!proposal || !sendMessageText.trim()) return;
    setSendingMessage(true);
    try {
      const res = await fetch("/api/admin/communications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: sendMessageProfileId, proposalId: proposal.id, channel: sendMessageChannel, message: sendMessageText.trim() }),
      });
      if (!res.ok) throw new Error();
      show("Message sent", "success");
      setSendMessageOpen(false);
    } catch {
      show("Could not send message.", "error");
    } finally {
      setSendingMessage(false);
    }
  }

  if (!proposal) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const responseFor = (profileId: string) => proposal.responses.find((r) => r.profileId === profileId);
  const permissionFor = (profileId: string) => proposal.contactPermissions.find((p) => p.profileId === profileId);
  const isApproved = (p?: ContactPermissionRow) => !!p?.approvedAt && !p.revokedAt;
  const bothApproved = isApproved(permissionFor(proposal.profileAId)) && isApproved(permissionFor(proposal.profileBId));
  const currentIsLegacy = isLegacyStatus(proposal.status as never);
  const statusOptions = currentIsLegacy ? [proposal.status, ...SELECTABLE_STATUSES] : SELECTABLE_STATUSES;

  return (
    <div className="space-y-6">
      <Link href="/admin/proposals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Proposals
      </Link>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">{proposal.proposalCode}</p>
            <div className="flex items-center gap-3 text-lg font-medium">
              <Link href={`/admin/profiles/${proposal.profileA.id}`} className="text-primary hover:underline">
                {proposal.profileA.fullName}
              </Link>
              <span className="text-muted">&harr;</span>
              <Link href={`/admin/profiles/${proposal.profileB.id}`} className="text-primary hover:underline">
                {proposal.profileB.fullName}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[proposal.priority]}>{formatEnumLabel(proposal.priority)} Priority</Badge>
            <StatusBadge status={proposal.status} />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {proposal.profileA.profileCode} &middot; {proposal.profileB.profileCode}
          {proposal.matchScore != null ? ` · ${proposal.matchScore}% match` : ""}
          {proposal.assignedTo ? ` · Assigned to ${proposal.assignedTo.name}` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="flex gap-6 overflow-x-auto py-4">
            <ProfileSummary profile={proposal.profileA} title="Profile A" />
            <div className="w-px shrink-0 bg-border" />
            <ProfileSummary profile={proposal.profileB} title="Profile B" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[proposal.profileA, proposal.profileB].map((p) => {
              const r = responseFor(p.id);
              return (
                <div key={p.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span>{p.fullName}</span>
                    {r ? (
                      <Badge variant={r.response === "INTERESTED" ? "success" : r.response === "NOT_INTERESTED" ? "danger" : "warning"}>
                        {formatEnumLabel(r.response)}
                      </Badge>
                    ) : (
                      <Badge variant="muted">Pending</Badge>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="px-2 py-1 text-xs" onClick={() => recordResponse(p.id, "INTERESTED")}>
                      Interested
                    </Button>
                    <Button size="sm" variant="outline" className="px-2 py-1 text-xs" onClick={() => recordResponse(p.id, "NOT_INTERESTED")}>
                      Not Interested
                    </Button>
                    <Button size="sm" variant="outline" className="px-2 py-1 text-xs" onClick={() => recordResponse(p.id, "NEED_MORE_INFO")}>
                      Need Info
                    </Button>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-muted">Record on the applicant&apos;s behalf (e.g. a phone call) — they can also respond themselves via My Rishta Proposals.</p>
          </CardContent>
        </Card>
      </div>

      {proposal.breakdown && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compatibility Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <CompatibilityBreakdownList breakdown={proposal.breakdown} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" /> Contact Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[proposal.profileA, proposal.profileB].map((p) => {
            const perm = permissionFor(p.id);
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">{p.fullName}</p>
                  <p className="text-xs text-muted">
                    {isApproved(perm) ? `Approved${perm?.approvedBy ? ` by ${perm.approvedBy.name}` : ""}` : perm?.requestedAt ? "Permission Requested" : "Private — not yet requested"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!perm?.requestedAt && (
                    <Button size="sm" variant="outline" onClick={() => contactPermissionAction(p.id, "request")}>
                      Request Contact Permission
                    </Button>
                  )}
                  {perm?.requestedAt && !isApproved(perm) && (
                    <Button size="sm" onClick={() => contactPermissionAction(p.id, "approve")}>
                      Approve Contact Sharing
                    </Button>
                  )}
                  {isApproved(perm) && (
                    <Button size="sm" variant="outline" onClick={() => contactPermissionAction(p.id, "revoke")}>
                      Keep Contact Private
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          {shared ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <ShieldCheck className="h-4 w-4" /> Contact details have been shared between these two profiles. This is recorded in the audit log.
            </p>
          ) : (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Reveal Contact Information</p>
              {!bothApproved && (
                <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Contact permission has not yet been approved by both sides — proceeding
                  anyway is an admin override.
                </p>
              )}
              <div className="space-y-1.5">
                <Checkbox label="Phone" checked={sharePhone} onChange={(e) => setSharePhone(e.target.checked)} />
                <Checkbox label="WhatsApp" checked={shareWhatsapp} onChange={(e) => setShareWhatsapp(e.target.checked)} />
                <Checkbox label="Email" checked={shareEmail} onChange={(e) => setShareEmail(e.target.checked)} />
              </div>
              <Checkbox label="Required consent has been received from both parties" checked={consentGiven} onChange={(e) => setConsentGiven(e.target.checked)} />
              <Button
                size="sm"
                onClick={() => setShareConfirmOpen(true)}
                disabled={!consentGiven || (!sharePhone && !shareWhatsapp && !shareEmail) || sharing}
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Approve Contact Sharing
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 text-primary" /> Meeting Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {proposal.meetings.length === 0 && <p className="text-sm text-muted">No meetings scheduled yet.</p>}
          {proposal.meetings.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="font-medium">
                  {formatEnumLabel(m.meetingType)} · {formatDateTime(m.scheduledAt)}
                </p>
                <p className="text-xs text-muted">{m.locationInfo || "No location noted"}{m.participants ? ` · ${m.participants}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={m.status} />
                {m.status !== "COMPLETED" && m.status !== "CANCELLED" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => updateMeetingStatus(m.id, "COMPLETED")}>
                      Mark Completed
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => updateMeetingStatus(m.id, "CANCELLED")}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}

          {showMeetingForm ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Meeting Type" htmlFor="meetingType">
                  <Select id="meetingType" value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
                    {MEETING_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {formatEnumLabel(t)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date &amp; Time" htmlFor="meetingDate">
                  <Input id="meetingDate" type="datetime-local" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
                </Field>
                <Field label="Location / Meeting Info" htmlFor="meetingLocation">
                  <Input id="meetingLocation" value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} />
                </Field>
                <Field label="Participants" htmlFor="meetingParticipants">
                  <Input id="meetingParticipants" value={meetingParticipants} onChange={(e) => setMeetingParticipants(e.target.value)} placeholder="e.g. Both families" />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={scheduleMeeting} disabled={!meetingDate || schedulingMeeting}>
                  {schedulingMeeting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save Meeting
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowMeetingForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowMeetingForm(true)}>
              <CalendarPlus className="h-4 w-4" /> Schedule Meeting
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" /> Family Communication
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {proposal.familyCommunications.length === 0 && <p className="text-sm text-muted">No family communication logged yet.</p>}
          {proposal.familyCommunications.map((f) => (
            <div key={f.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">
                {f.contactPerson} ({f.relationship}) · {formatEnumLabel(f.communicationMethod)} · {formatDate(f.communicationDate)}
              </p>
              {f.outcome && <p className="mt-1 text-xs text-muted">Outcome: {f.outcome}</p>}
              {f.notes && <p className="mt-1 text-xs text-muted">{f.notes}</p>}
            </div>
          ))}

          {showFamilyForm ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Regarding Profile" htmlFor="famProfile">
                  <Select id="famProfile" value={famProfileId} onChange={(e) => setFamProfileId(e.target.value)}>
                    <option value={proposal.profileAId}>{proposal.profileA.fullName}</option>
                    <option value={proposal.profileBId}>{proposal.profileB.fullName}</option>
                  </Select>
                </Field>
                <Field label="Contact Person" htmlFor="famContactPerson">
                  <Input id="famContactPerson" value={famContactPerson} onChange={(e) => setFamContactPerson(e.target.value)} />
                </Field>
                <Field label="Relationship" htmlFor="famRelationship">
                  <Input id="famRelationship" value={famRelationship} onChange={(e) => setFamRelationship(e.target.value)} placeholder="e.g. Father, Mother" />
                </Field>
                <Field label="Communication Method" htmlFor="famMethod">
                  <Select id="famMethod" value={famMethod} onChange={(e) => setFamMethod(e.target.value)}>
                    {["Phone", "WhatsApp", "Email", "In Person", "Video Call"].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date" htmlFor="famDate">
                  <Input id="famDate" type="date" value={famDate} onChange={(e) => setFamDate(e.target.value)} />
                </Field>
                <Field label="Outcome" htmlFor="famOutcome">
                  <Input id="famOutcome" value={famOutcome} onChange={(e) => setFamOutcome(e.target.value)} />
                </Field>
              </div>
              <Field label="Notes" htmlFor="famNotes">
                <Textarea id="famNotes" rows={2} value={famNotes} onChange={(e) => setFamNotes(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" onClick={logFamilyCommunication} disabled={!famContactPerson || !famRelationship || !famDate || loggingFamily}>
                  {loggingFamily ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowFamilyForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowFamilyForm(true)}>
              <Users className="h-4 w-4" /> Log Family Communication
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Follow-ups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {showFollowUpForm ? (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Regarding Profile" htmlFor="fuProfile">
                  <Select id="fuProfile" value={followUpProfileId} onChange={(e) => setFollowUpProfileId(e.target.value)}>
                    <option value={proposal.profileAId}>{proposal.profileA.fullName}</option>
                    <option value={proposal.profileBId}>{proposal.profileB.fullName}</option>
                  </Select>
                </Field>
                <Field label="Due Date" htmlFor="fuDate">
                  <Input id="fuDate" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
                </Field>
              </div>
              <Field label="Purpose" htmlFor="fuPurpose">
                <Input id="fuPurpose" value={followUpPurpose} onChange={(e) => setFollowUpPurpose(e.target.value)} placeholder="e.g. Check on family discussion" />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" onClick={addFollowUp} disabled={!followUpDate || addingFollowUp}>
                  {addingFollowUp ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add Follow-up
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowFollowUpForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setShowFollowUpForm(true)}>
              <CalendarPlus className="h-4 w-4" /> Add Follow-up
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline
              items={proposal.events.map((e) => ({
                id: e.id,
                label: (ADMIN_STATUS_LABEL as Record<string, string>)[e.status] ?? e.status.replaceAll("_", " "),
                description: [e.note, e.performedByAdmin ? `by ${e.performedByAdmin.name}` : e.performedByProfile ? `by ${e.performedByProfile.fullName} (applicant)` : null]
                  .filter(Boolean)
                  .join(" — "),
                date: e.createdAt,
                active: e.id === proposal.events[proposal.events.length - 1]?.id,
              }))}
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Change Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {(ADMIN_STATUS_LABEL as Record<string, string>)[s] ?? s}
                  </option>
                ))}
              </Select>
              <Textarea placeholder="Add a note about this update (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button className="w-full" size="sm" onClick={updateStatus} disabled={saving || status === "REJECTED"}>
                Save Update
              </Button>
              {status === "REJECTED" && <p className="text-xs text-muted">Use the &quot;Reject Proposal&quot; action below — it requires a reason.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Edit Proposal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Priority" htmlFor="priority">
                <Select id="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </Select>
              </Field>
              <Button size="sm" className="w-full" onClick={savePriority} disabled={saving}>
                Save Priority
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserCog className="h-4 w-4 text-primary" /> Staff Assignment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" className="w-full" variant="outline" onClick={assignStaff} disabled={assigning}>
                Assign
              </Button>
              <p className="text-xs text-muted">Staff can only manage proposals assigned to them. Assigning requires Super Admin.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-primary" /> Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {proposal.notes.map((n) => (
                <div key={n.id} className="rounded-lg bg-surface-muted p-2 text-xs">
                  <p>{n.text}</p>
                  <p className="mt-1 text-muted">
                    {n.admin.name} · {formatDateTime(n.createdAt)}
                  </p>
                </div>
              ))}
              <Textarea placeholder="Add a private admin note" value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={2} />
              <Button size="sm" className="w-full" onClick={addNote} disabled={!newNote.trim() || addingNote}>
                Add Note
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={openSendMessage}>
                <Bell className="h-4 w-4" /> Send Message
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => patchProposal({ status: "ON_HOLD" }).then(load)}>
                <Ban className="h-4 w-4" /> Put On Hold
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setRejectOpen(true)} disabled={proposal.status === "REJECTED"}>
                <ThumbsDown className="h-4 w-4" /> Reject Proposal
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setFinalizeOpen(true)} disabled={proposal.status === "FINALIZED"}>
                <CheckCircle2 className="h-4 w-4" /> Finalize Rishta
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setMarriedOpen(true)} disabled={proposal.status === "MARRIED"}>
                <Heart className="h-4 w-4" /> Mark as Married
              </Button>
              <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setArchiveOpen(true)} disabled={proposal.status === "ARCHIVED"}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={rejectOpen}
        title="Reject Proposal"
        description="This will close the proposal for both profiles. The reason and note stay private — they are never shown to the other party."
        confirmLabel="Reject Proposal"
        danger
        confirmDisabled={!rejectReason || dangerBusy}
        onConfirm={() => runDangerAction({ status: "REJECTED", rejectionReason: rejectReason, internalRejectionNote: rejectNote || undefined }, "Proposal rejected")}
        onCancel={() => setRejectOpen(false)}
      >
        <Field label="Rejection Reason" htmlFor="rejectReason">
          <Select id="rejectReason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
            <option value="">Select a reason…</option>
            {DECLINE_REASONS.map((r) => (
              <option key={r} value={r}>
                {formatEnumLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Internal Note (private)" htmlFor="rejectNote">
          <Textarea id="rejectNote" rows={2} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={sendMessageOpen}
        title="Send Message"
        description="Review the recipient, channel, and message before sending — external channels require this confirmation."
        confirmLabel="Send"
        confirmDisabled={!sendMessageText.trim() || sendingMessage}
        onConfirm={sendMessage}
        onCancel={() => setSendMessageOpen(false)}
      >
        <Field label="Recipient" htmlFor="sendMessageProfileId">
          <Select id="sendMessageProfileId" value={sendMessageProfileId} onChange={(e) => setSendMessageProfileId(e.target.value)}>
            <option value={proposal.profileA.id}>{proposal.profileA.fullName}</option>
            <option value={proposal.profileB.id}>{proposal.profileB.fullName}</option>
          </Select>
        </Field>
        <Field label="Channel" htmlFor="sendMessageChannel">
          <Select id="sendMessageChannel" value={sendMessageChannel} onChange={(e) => setSendMessageChannel(e.target.value)}>
            <option value="IN_APP">In-App</option>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="WHATSAPP">WhatsApp</option>
          </Select>
        </Field>
        <Field label="Message" htmlFor="sendMessageText">
          <Textarea id="sendMessageText" rows={3} value={sendMessageText} onChange={(e) => setSendMessageText(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">Related Proposal: {proposal.proposalCode ?? proposal.id}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={finalizeOpen}
        title="Finalize Rishta"
        description="Are you sure you want to mark this proposal as finalized?"
        confirmLabel="Finalize"
        confirmDisabled={dangerBusy}
        onConfirm={() => runDangerAction({ status: "FINALIZED" }, "Proposal finalized")}
        onCancel={() => setFinalizeOpen(false)}
      />

      <ConfirmDialog
        open={marriedOpen}
        title="Mark as Married"
        description="This records both profiles as married and closes the matchmaking process. Personal matrimonial details are never shown publicly."
        confirmLabel="Mark as Married"
        confirmDisabled={dangerBusy}
        onConfirm={() => runDangerAction({ status: "MARRIED" }, "Marked as married")}
        onCancel={() => setMarriedOpen(false)}
      />

      <ConfirmDialog
        open={archiveOpen}
        title="Archive Proposal"
        description="This proposal will be moved to the archive and excluded from active workflows."
        confirmLabel="Archive"
        danger
        confirmDisabled={dangerBusy}
        onConfirm={() => runDangerAction({ status: "ARCHIVED" }, "Proposal archived")}
        onCancel={() => setArchiveOpen(false)}
      />

      <ConfirmDialog
        open={shareConfirmOpen}
        title="Approve Contact Sharing"
        description="This reveals real contact information (phone/WhatsApp/email) between these two profiles and is recorded in the audit log. This cannot be undone."
        confirmLabel="Approve Contact Sharing"
        danger
        confirmDisabled={sharing}
        onConfirm={() => {
          setShareConfirmOpen(false);
          shareContact();
        }}
        onCancel={() => setShareConfirmOpen(false)}
      />
    </div>
  );
}
