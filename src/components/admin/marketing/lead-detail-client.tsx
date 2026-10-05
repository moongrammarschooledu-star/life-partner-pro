"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

// Admin -> Marketing -> Lead. Contact details are masked unless the viewer holds the dedicated contact permission, and
// viewing them is audited on the server. Attribution here is a single verified touch — it is evidence, not a promise.

const MANUAL_STATUSES = ["CONTACTED", "RESPONDED", "QUALIFICATION_PENDING", "QUALIFIED", "REGISTRATION_STARTED", "UNQUALIFIED", "NOT_INTERESTED", "INVALID", "DO_NOT_CONTACT", "ARCHIVED", "DUPLICATE"];

interface LeadDetail {
  lead: { id: string; leadCode: string; fullName: string; phone: string | null; email: string | null; city: string | null; inquiry: string | null; contactMasked: boolean; status: string; source: string; campaignId: string | null; campaignCode: string | null; platform: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; preferredChannel: string | null; marketingOptIn: boolean; dedupeReason: string | null; convertedProfileId: string | null; capturedAt: string | null };
  attribution: { code: string; verification: string; referrerHost: string | null; model: string; touchedAt: string | null } | null;
  consents: Array<{ purpose: string; channel: string | null; granted: boolean; withdrawnAt: string | null; method: string; recordedAt: string }>;
  crmRecord: { crmCode: string; lifecycleStage: string } | null;
  tasks: Array<{ id: string; taskCode: string; taskType: string; status: string; dueAt: string | null }>;
  timeline: Array<{ at: string; label: string }>;
}

export function MarketingLeadClient({ id, permissions }: { id: string; permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<LeadDetail>(`/api/admin/marketing/leads/${id}`);
  const [status, setStatus] = useState("CONTACTED");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Lead not found."} />;
  const { lead } = data;

  async function run(path: string, method: "PATCH" | "POST", body: unknown, msg: string) {
    setBusy(true);
    const ok = await act(show, `/api/admin/marketing/leads/${id}${path}`, method, body, msg);
    setBusy(false);
    if (ok) { setReason(""); reload(); }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/marketing" className="text-sm text-primary hover:underline">← Marketing Center</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{lead.fullName}</h1>
          <StatusBadge status={lead.status} />
          <span className="font-mono text-xs text-muted">{lead.leadCode}</span>
        </div>
        <p className="text-sm text-muted">{lead.campaignCode ? <>Campaign <Link className="text-primary hover:underline" href={`/admin/marketing/campaigns/${lead.campaignId}`}>{lead.campaignCode}</Link></> : "No campaign"}{lead.platform ? ` · via ${formatEnumLabel(lead.platform)}` : ""}</p>
      </div>

      {lead.dedupeReason && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">Possible duplicate flagged for review: {formatEnumLabel(lead.dedupeReason)}. Nothing is merged automatically.</p>}

      <Card title="Contact">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Mobile" v={lead.phone ?? "—"} />
          <Row k="Email" v={lead.email ?? "—"} />
          <Row k="City" v={lead.city ?? "—"} />
          <Row k="Preferred channel" v={lead.preferredChannel ? formatEnumLabel(lead.preferredChannel) : "—"} />
          <Row k="Marketing opt-in" v={lead.marketingOptIn ? "Yes (evidence only)" : "No"} />
        </dl>
        {lead.contactMasked && <p className="mt-2 text-xs text-muted">Contact details are masked for your role.</p>}
        {lead.inquiry && <p className="mt-3 whitespace-pre-line rounded-lg border border-border bg-background p-3 text-sm">{lead.inquiry}</p>}
      </Card>

      <Card title="Attribution">
        {data.attribution ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Verification" v={formatEnumLabel(data.attribution.verification)} />
            <Row k="Model" v={formatEnumLabel(data.attribution.model)} />
            <Row k="UTM source / medium / campaign" v={`${lead.utmSource ?? "—"} / ${lead.utmMedium ?? "—"} / ${lead.utmCampaign ?? "—"}`} />
            <Row k="Referrer" v={data.attribution.referrerHost ?? "—"} />
          </dl>
        ) : <p className="text-sm text-muted">No attribution record.</p>}
        <p className="mt-2 text-xs text-muted">Unverified attribution is kept for context but excluded from ROI.</p>
      </Card>

      <Card title="Consent evidence">
        {data.consents.length === 0 ? <p className="text-sm text-muted">No consent records.</p> : (
          <ul className="space-y-1 text-sm">{data.consents.map((c, i) => <li key={i} className="flex flex-wrap justify-between gap-2"><span>{formatEnumLabel(c.purpose)}{c.channel ? ` · ${formatEnumLabel(c.channel)}` : ""} — {c.granted ? "granted" : "declined"}{c.withdrawnAt ? ` (withdrawn ${formatDateTime(c.withdrawnAt)})` : ""}</span><span className="text-muted">{formatDateTime(c.recordedAt)}</span></li>)}</ul>
        )}
        {can("marketing:leads:manage") && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Reason for withdrawal" className="min-w-64 flex-1"><Textarea rows={1} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => run("/withdraw-consent", "POST", { reason }, "Consent withdrawn and marketing suppressed.")}>Record withdrawal</Button>
          </div>
        )}
      </Card>

      {can("marketing:leads:manage") && (
        <Card title="Update status">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="New status"><Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">{MANUAL_STATUSES.map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}</Select></Field>
            <Field label="Reason" className="min-w-64 flex-1"><Textarea rows={1} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button disabled={busy || !reason.trim()} onClick={() => run("", "PATCH", { status, reason }, "Status updated.")}>Update</Button>
          </div>
        </Card>
      )}

      {data.crmRecord && <Card title="CRM"><p className="text-sm">Converted to applicant — {data.crmRecord.crmCode}, stage {formatEnumLabel(data.crmRecord.lifecycleStage)}.</p></Card>}
      {data.tasks.length > 0 && (
        <Card title="Tasks">
          <ul className="space-y-1 text-sm">{data.tasks.map((t) => <li key={t.id} className="flex justify-between"><span>{t.taskCode} · {formatEnumLabel(t.taskType)}</span><StatusBadge status={t.status} /></li>)}</ul>
        </Card>
      )}

      <Card title="Timeline">
        <ol className="space-y-1 text-sm">{data.timeline.map((e, i) => <li key={i} className="flex justify-between gap-3"><span>{e.label}</span><span className="shrink-0 text-muted">{formatDateTime(e.at)}</span></li>)}</ol>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3 border-b border-border/60 pb-1"><dt className="text-muted">{k}</dt><dd className="text-end font-medium">{v}</dd></div>;
}
