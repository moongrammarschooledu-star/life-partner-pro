"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, Share2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, Textarea, Checkbox } from "@/components/ui/form";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Timeline } from "@/components/ui/timeline";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface ProposalDetail {
  id: string;
  status: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  matchScore: number | null;
  createdAt: string;
  profileA: { id: string; profileCode: string; fullName: string; gender: string };
  profileB: { id: string; profileCode: string; fullName: string; gender: string };
  events: { id: string; status: string; note: string | null; createdAt: string }[];
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

const STATUSES = ["DRAFT", "SENT", "INTERESTED", "NOT_INTERESTED", "WAITING", "MEETING", "FINALIZED", "CLOSED"];

export default function ProposalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [sharePhone, setSharePhone] = useState(false);
  const [shareWhatsapp, setShareWhatsapp] = useState(false);
  const [shareEmail, setShareEmail] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  function load() {
    fetch(`/api/admin/proposals/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setProposal(data);
        setStatus(data.status);
      });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function updateStatus() {
    if (!proposal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/proposals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note || undefined }),
      });
      if (!res.ok) throw new Error();
      show("Proposal updated", "success");
      setNote("");
      load();
    } catch {
      show("Could not update proposal.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function shareContact() {
    if (!proposal || !consentGiven || (!sharePhone && !shareWhatsapp && !shareEmail)) return;
    setSharing(true);
    try {
      const res = await fetch(`/api/admin/profiles/${proposal.profileA.id}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otherProfileId: proposal.profileB.id,
          phoneShared: sharePhone,
          whatsappShared: shareWhatsapp,
          emailShared: shareEmail,
        }),
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

  if (!proposal) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/proposals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Proposals
      </Link>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-lg font-medium">
            <Link href={`/admin/profiles/${proposal.profileA.id}`} className="text-primary hover:underline">
              {proposal.profileA.fullName}
            </Link>
            <span className="text-muted">&harr;</span>
            <Link href={`/admin/profiles/${proposal.profileB.id}`} className="text-primary hover:underline">
              {proposal.profileB.fullName}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={PRIORITY_VARIANT[proposal.priority]}>{formatEnumLabel(proposal.priority)} Priority</Badge>
            <StatusBadge status={proposal.status} />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {proposal.profileA.profileCode} &middot; {proposal.profileB.profileCode}
          {proposal.matchScore != null ? ` · ${proposal.matchScore}% match` : ""}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Timeline
              items={proposal.events.map((e) => ({
                id: e.id,
                label: e.status.replaceAll("_", " "),
                description: e.note ?? undefined,
                date: e.createdAt,
                active: e.id === proposal.events[proposal.events.length - 1]?.id,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
            <Textarea placeholder="Add a note about this update (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button className="w-full" size="sm" onClick={updateStatus} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Save Update
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Share2 className="h-4 w-4 text-primary" /> Contact Sharing
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shared ? (
              <p className="flex items-center gap-2 text-sm text-success">
                <ShieldCheck className="h-4 w-4" /> Contact details have been shared between these two profiles. This is recorded in the
                audit log.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Contact Information — Admin Only</p>
                <p className="text-sm text-muted">
                  Request or approve sharing {proposal.profileA.fullName}&apos;s and {proposal.profileB.fullName}&apos;s contact details
                  with each other. Only do this after both sides have expressed genuine interest — every share is permanently recorded.
                </p>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Information to share</p>
                  <Checkbox label="Phone" checked={sharePhone} onChange={(e) => setSharePhone(e.target.checked)} />
                  <Checkbox label="WhatsApp" checked={shareWhatsapp} onChange={(e) => setShareWhatsapp(e.target.checked)} />
                  <Checkbox label="Email" checked={shareEmail} onChange={(e) => setShareEmail(e.target.checked)} />
                </div>
                <Checkbox
                  label="Required consent has been received from both parties"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                />
                <Button
                  size="sm"
                  onClick={shareContact}
                  disabled={!consentGiven || (!sharePhone && !shareWhatsapp && !shareEmail) || sharing}
                >
                  {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} Approve Contact Sharing
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
