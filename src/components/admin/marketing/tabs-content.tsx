"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, timeAgo, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";
import { formatEnumLabel } from "@/lib/utils";

type Can = (p: string) => boolean;

// ------------------------------------------------------------------ Ads (provider-neutral hierarchy)
interface AdNode { id: string; campaignId: string; parentId: string | null; level: string; providerKey: string; externalId: string | null; name: string; status: string; lastSyncedAt: string | null }

export function AdsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: AdNode[] }>("/api/admin/marketing/ads");
  const [busy, setBusy] = useState(false);
  async function runTick() {
    setBusy(true);
    await act(show, "/api/admin/marketing/tick", "POST", {}, "Marketing daily tasks ran.");
    setBusy(false);
    reload();
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">The ad hierarchy is shown provider-neutrally (ad campaign → ad set / ad group → ad) because platforms differ. Entries appear after a campaign has been launched on a connected provider.</p>
      {can("marketing:ads:manage") && <Button variant="outline" onClick={runTick} disabled={busy}>{busy ? "Running…" : "Run daily marketing tasks now"}</Button>}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No ad entries yet" description="Nothing has been created at an ad provider." /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Name</th><th className="pb-2">Level</th><th className="pb-2">Provider</th><th className="pb-2">Status</th><th className="pb-2">Last synced</th></tr></thead>
            <tbody>
              {data.items.map((n) => (
                <tr key={n.id} className="border-t border-border">
                  <td className="py-2" style={{ paddingInlineStart: n.parentId ? 20 : 0 }}><Link href={`/admin/marketing/campaigns/${n.campaignId}`} className="text-primary hover:underline">{n.name}</Link></td>
                  <td className="py-2">{formatEnumLabel(n.level)}</td><td className="py-2">{formatEnumLabel(n.providerKey)}</td><td className="py-2"><StatusBadge status={n.status} /></td><td className="py-2 text-muted">{timeAgo(n.lastSyncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Creatives
interface Creative { id: string; code: string; name: string; status: string; headline: string; body: string; ctaLabel: string; language: string; campaignId: string | null; createdById: string }

export function CreativesTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: Creative[] }>("/api/admin/marketing/creatives");
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", headline: "", body: "", ctaLabel: "Learn more", language: "EN", campaignId: "" });
  const [preview, setPreview] = useState<Creative | null>(null);

  async function create() {
    if (await act(show, "/api/admin/marketing/creatives", "POST", { ...f, campaignId: f.campaignId || null }, "Creative saved as a draft.")) { setCreating(false); reload(); }
  }
  const call = async (id: string, path: string, body: unknown, msg: string) => { if (await act(show, `/api/admin/marketing/creatives/${id}/${path}`, "POST", body, msg)) reload(); };

  return (
    <div className="space-y-3">
      {can("marketing:creatives:create") && <Button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New creative"}</Button>}
      {creating && (
        <Card title="New creative (draft)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
            <Field label="Headline" className="sm:col-span-2"><Input value={f.headline} maxLength={120} onChange={(e) => setF({ ...f, headline: e.target.value })} /></Field>
            <Field label="Primary text" className="sm:col-span-2"><Textarea rows={3} maxLength={600} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
            <Field label="Call to action"><Input value={f.ctaLabel} maxLength={40} onChange={(e) => setF({ ...f, ctaLabel: e.target.value })} /></Field>
            <Field label="Campaign id (optional)"><Input value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value.trim() })} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">Avoid guarantees, perfect-match claims, urgency pressure, and any reference to religion, sect, caste, income or appearance. The content check runs when you submit for review.</p>
          <div className="mt-3"><Button onClick={create} disabled={!f.name || !f.headline || !f.body}>Save draft</Button></div>
        </Card>
      )}
      {preview && (
        <Card title={`Preview — ${preview.code}`} action={<Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Close</Button>}>
          <div dir={preview.language === "UR" ? "rtl" : "ltr"} className="mx-auto max-w-sm space-y-2 rounded-xl border border-border bg-background p-4">
            <p className="text-xs text-muted">Sponsored</p>
            <p className="whitespace-pre-line text-sm">{preview.body}</p>
            <p className="font-semibold">{preview.headline}</p>
            <span className="inline-block rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">{preview.ctaLabel}</span>
          </div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No creatives yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Creative</th><th className="pb-2">Status</th><th className="pb-2">Headline</th><th className="pb-2 text-right">Actions</th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2 font-medium">{c.code} <span className="font-normal text-muted">{c.name}</span></td>
                  <td className="py-2"><StatusBadge status={c.status} /></td>
                  <td className="py-2">{c.headline}</td>
                  <td className="py-2 text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => setPreview(c)}>Preview</Button>
                    {(c.status === "DRAFT" || c.status === "REJECTED") && can("marketing:creatives:edit") && <Button size="sm" variant="outline" onClick={() => call(c.id, "submit", {}, "Submitted for review.")}>Submit</Button>}
                    {c.status === "REVIEW" && can("marketing:creatives:approve") && (
                      <>
                        <Button size="sm" onClick={() => call(c.id, "review", { decision: "APPROVE" }, "Creative approved.")}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => { const reason = window.prompt("Reason for rejecting"); if (reason) void call(c.id, "review", { decision: "REJECT", reason }, "Creative rejected."); }}>Reject</Button>
                      </>
                    )}
                    {c.status === "APPROVED" && can("marketing:creatives:approve") && <Button size="sm" variant="outline" onClick={() => call(c.id, "status", { status: "ACTIVE" }, "Creative activated.")}>Activate</Button>}
                    {(c.status === "ACTIVE") && can("marketing:creatives:approve") && <Button size="sm" variant="outline" onClick={() => call(c.id, "status", { status: "PAUSED" }, "Creative paused.")}>Pause</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Lead forms
interface FormRow { id: string; code: string; name: string; status: string; publishedVersionId: string | null; latestVersion: { version: number; status: string } | null }

const OPTIONAL_FIELDS: Array<[string, string]> = [["phone", "Mobile number"], ["whatsapp", "WhatsApp number"], ["email", "Email"], ["city", "City"], ["preferredChannel", "Preferred contact method"], ["inquiry", "Message"], ["referralCode", "Referral code"]];

export function FormsTab({ can }: { can: Can }) {
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: FormRow[] }>("/api/admin/marketing/forms");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({ phone: true, email: true, city: true, preferredChannel: true });
  const [inquiryText, setInquiryText] = useState("I agree that Life Partner Pro may contact me about my inquiry.");
  const [mkt, setMkt] = useState({ enabled: false, text: "I would like to receive updates about Life Partner Pro by the channels I have provided." });
  const [wa, setWa] = useState({ enabled: false, text: "I agree to be contacted on WhatsApp about my inquiry." });

  async function create() {
    const fields = [{ key: "fullName", label: "Full name", required: true }, ...OPTIONAL_FIELDS.filter(([k]) => picked[k]).map(([key, label]) => ({ key, label, required: false }))];
    const consentConfig = { inquiryContact: { required: true, text: inquiryText }, marketingUpdates: { enabled: mkt.enabled, ...(mkt.enabled ? { text: mkt.text } : {}), defaultChecked: false }, whatsapp: { enabled: wa.enabled, ...(wa.enabled ? { text: wa.text } : {}), defaultChecked: false }, privacyNoticeLinkRequired: true };
    if (await act(show, "/api/admin/marketing/forms", "POST", { name, fields, consentConfig, privacyNoticeVersionId: "STATIC_PRIVACY_POLICY" }, "Form saved as a draft.")) { setCreating(false); setName(""); reload(); }
  }
  const call = async (id: string, path: string, body: unknown, msg: string) => { if (await act(show, `/api/admin/marketing/forms/${id}/${path}`, "POST", body, msg)) reload(); };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Collect only what you need to follow up. Sensitive details (religion, income, date of birth, ID numbers, photos, health) cannot be added to a marketing form. Consent boxes are never pre-ticked.</p>
      {can("marketing:forms:create") && <Button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New form"}</Button>}
      {creating && (
        <Card title="New lead form (draft)">
          <Field label="Form name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <p className="mt-3 text-sm font-medium">Fields (name is always required; at least one way to reach the person is needed)</p>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {OPTIONAL_FIELDS.map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!picked[k]} onChange={(e) => setPicked({ ...picked, [k]: e.target.checked })} />{l}</label>)}
          </div>
          <div className="mt-3 space-y-2">
            <Field label="Consent to be contacted about the inquiry (required)"><Textarea rows={2} value={inquiryText} onChange={(e) => setInquiryText(e.target.value)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mkt.enabled} onChange={(e) => setMkt({ ...mkt, enabled: e.target.checked })} /> Offer an optional marketing-updates consent</label>
            {mkt.enabled && <Textarea rows={2} value={mkt.text} onChange={(e) => setMkt({ ...mkt, text: e.target.value })} />}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wa.enabled} onChange={(e) => setWa({ ...wa, enabled: e.target.checked })} /> Offer an optional WhatsApp consent</label>
            {wa.enabled && <Textarea rows={2} value={wa.text} onChange={(e) => setWa({ ...wa, text: e.target.value })} />}
          </div>
          <div className="mt-3"><Button onClick={create} disabled={!name.trim()}>Save draft</Button></div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No forms yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Form</th><th className="pb-2">Form status</th><th className="pb-2">Latest version</th><th className="pb-2 text-right">Actions</th></tr></thead>
            <tbody>
              {data.items.map((f) => {
                const v = f.latestVersion;
                return (
                  <tr key={f.id} className="border-t border-border">
                    <td className="py-2 font-medium">{f.code} <span className="font-normal text-muted">{f.name}</span></td>
                    <td className="py-2"><StatusBadge status={f.status} /></td>
                    <td className="py-2">{v ? <>v{v.version} <StatusBadge status={v.status} /></> : "—"}</td>
                    <td className="py-2 text-right space-x-1">
                      {v && (v.status === "DRAFT" || v.status === "REJECTED") && can("marketing:forms:create") && <Button size="sm" variant="outline" onClick={() => call(f.id, "submit-review", { version: v.version }, "Submitted for review.")}>Submit</Button>}
                      {v && v.status === "REVIEW" && can("marketing:forms:manage") && (
                        <>
                          <Button size="sm" onClick={() => call(f.id, "review", { version: v.version, decision: "APPROVE" }, "Version approved.")}>Approve</Button>
                          <Button size="sm" variant="danger" onClick={() => call(f.id, "review", { version: v.version, decision: "REJECT" }, "Version rejected.")}>Reject</Button>
                        </>
                      )}
                      {v && v.status === "APPROVED" && can("marketing:forms:manage") && <Button size="sm" onClick={() => { const reason = window.prompt("Reason for publishing"); if (reason) void call(f.id, "publish", { version: v.version, reason }, "Form published."); }}>Publish</Button>}
                      {f.status === "PUBLISHED" && can("marketing:forms:manage") && <Button size="sm" variant="outline" onClick={() => { const reason = window.prompt("Reason for unpublishing"); if (reason) void call(f.id, "unpublish", { reason }, "Form unpublished."); }}>Unpublish</Button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Marketing leads
interface LeadRow { id: string; leadCode: string; fullName: string; phone: string | null; email: string | null; contactMasked: boolean; status: string; source: string; campaignCode: string | null; marketingOptIn: boolean; createdAt: string }

export function LeadsTab({ can }: { can: Can }) {
  const [status, setStatus] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(campaignId ? { campaignId } : {}) }).toString();
  const { data, error, loading } = useApi<{ items: LeadRow[]; nextCursor: string | null }>(`/api/admin/marketing/leads${qs ? `?${qs}` : ""}`);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-52"><option value="">Any status</option>{["NEW", "CONTACTED", "RESPONDED", "QUALIFICATION_PENDING", "QUALIFIED", "DUPLICATE_REVIEW_REQUIRED", "REGISTRATION_STARTED", "REGISTERED", "CONVERTED", "UNQUALIFIED", "NOT_INTERESTED", "DO_NOT_CONTACT", "INVALID", "ARCHIVED"].map((s) => <option key={s} value={s}>{formatEnumLabel(s)}</option>)}</Select>
        <Input value={campaignId} onChange={(e) => setCampaignId(e.target.value.trim())} placeholder="Campaign id" className="w-56" />
        {can("marketing:leads:export") && <a className="text-sm text-primary hover:underline" href={`/api/admin/marketing/leads/export?reason=Marketing%20report${campaignId ? `&campaignId=${campaignId}` : ""}`}>Export (no contact details)</a>}
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No marketing leads yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Lead</th><th className="pb-2">Contact</th><th className="pb-2">Status</th><th className="pb-2">Campaign</th><th className="pb-2">Opt-in</th><th className="pb-2">Captured</th></tr></thead>
            <tbody>
              {data.items.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2"><Link href={`/admin/marketing/leads/${l.id}`} className="font-medium text-primary hover:underline">{l.leadCode}</Link> <span className="text-muted">{l.fullName}</span></td>
                  <td className="py-2 text-muted">{l.phone ?? l.email ?? "—"}{l.contactMasked && (l.phone || l.email) ? " (masked)" : ""}</td>
                  <td className="py-2"><StatusBadge status={l.status} /></td>
                  <td className="py-2">{l.campaignCode ?? "—"}</td>
                  <td className="py-2">{l.marketingOptIn ? "Yes" : "No"}</td>
                  <td className="py-2 text-muted">{timeAgo(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
