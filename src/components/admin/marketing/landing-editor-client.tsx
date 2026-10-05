"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";
import { formatDateTime } from "@/lib/utils";

// Admin -> Marketing -> Landing page editor. Content is a list of structured sections (JSON) — there is no raw-HTML field.
// The server validates the shape, runs the content policy, and pins what was reviewed to a content hash; approving needs
// someone other than the author, and publishing a version that was not approved is refused.

interface Version {
  id: string; version: number; status: string; title: string; metaDescription: string | null; canonicalUrl: string | null; ogTitle: string | null; ogDescription: string | null;
  socialImageUrl: string | null; sections: Array<Record<string, unknown>>; changeSummary: string | null; authorId: string; reviewerId: string | null; publishedAt: string | null; createdAt: string;
  policyScanResult: { pass?: boolean; findings?: Array<{ rule: string; severity: string; snippet: string }> } | null;
}
interface PageData { id: string; code: string; slug: string; name: string; status: string; language: string; publishedVersionId: string | null; noindex: boolean; sitemapInclude: boolean; versions: Version[] }
interface FormRow { id: string; code: string; name: string; status: string }

function outline(sections: Array<Record<string, unknown>>): string[] {
  return sections.map((s) => {
    const heading = typeof s.heading === "string" ? s.heading : typeof s.body === "string" ? s.body.slice(0, 60) : "";
    return `${String(s.type)}${heading ? ` — ${heading}` : ""}`;
  });
}

export function LandingEditorClient({ id, permissions }: { id: string; permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<PageData>(`/api/admin/marketing/landing-pages/${id}`);
  const forms = useApi<{ items: FormRow[] }>("/api/admin/marketing/forms");
  const [selected, setSelected] = useState<number | null>(null);
  const [fields, setFields] = useState({ title: "", metaDescription: "", canonicalUrl: "", ogTitle: "", ogDescription: "", changeSummary: "" });
  const [json, setJson] = useState("[]");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => data?.versions.find((v) => v.version === (selected ?? data.versions[0]?.version)) ?? null, [data, selected]);

  useEffect(() => {
    if (!current) return;
    setFields({ title: current.title, metaDescription: current.metaDescription ?? "", canonicalUrl: current.canonicalUrl ?? "", ogTitle: current.ogTitle ?? "", ogDescription: current.ogDescription ?? "", changeSummary: "" });
    setJson(JSON.stringify(current.sections, null, 2));
  }, [current]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Landing page not found."} />;
  const page = data;

  let parsed: Array<Record<string, unknown>> | null = null;
  let parseError: string | null = null;
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) throw new Error("Sections must be a list.");
    parsed = v as Array<Record<string, unknown>>;
  } catch (e) {
    parseError = e instanceof Error ? e.message : "Invalid JSON";
  }

  const editable = !!current && (current.status === "DRAFT" || current.status === "REJECTED");
  const base = `/api/admin/marketing/landing-pages/${page.id}`;
  const run = async (path: string, method: "POST" | "PATCH", body: unknown, msg: string) => {
    setBusy(true);
    const ok = await act(show, `${base}${path}`, method, body, msg);
    setBusy(false);
    if (ok) { setReason(""); reload(); }
    return ok;
  };

  function addForm(formId: string) {
    if (!parsed || !formId) return;
    const next = parsed.filter((s) => s.type !== "FORM_EMBED");
    const idx = next.findIndex((s) => s.type === "DISCLAIMER");
    const section = { id: "form", type: "FORM_EMBED", heading: "Request a call-back", formId };
    if (idx >= 0) next.splice(idx, 0, section); else next.push(section);
    setJson(JSON.stringify(next, null, 2));
  }

  const saveBody = () => ({ ...fields, sections: parsed, changeSummary: fields.changeSummary || null });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/marketing/landing-pages" className="text-sm text-primary hover:underline">← Landing pages</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{page.name}</h1>
          <StatusBadge status={page.status} />
          <span className="font-mono text-xs text-muted">{page.code} · /lp/{page.slug}</span>
        </div>
      </div>

      <Card title="Versions">
        <ul className="space-y-1 text-sm">
          {page.versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setSelected(v.version)} className={`text-start hover:underline ${current?.version === v.version ? "font-semibold" : ""}`}>
                v{v.version} <span className="text-muted">· {formatDateTime(v.createdAt)}{v.id === page.publishedVersionId ? " · live" : ""}</span>
              </button>
              <StatusBadge status={v.status} />
            </li>
          ))}
        </ul>
      </Card>

      {current && (
        <>
          <Card title={`Version ${current.version} — ${editable ? "editable draft" : "read-only (approved or submitted versions never change)"}`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Page title"><Input disabled={!editable} maxLength={160} value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} /></Field>
              <Field label="Meta description"><Input disabled={!editable} maxLength={300} value={fields.metaDescription} onChange={(e) => setFields({ ...fields, metaDescription: e.target.value })} /></Field>
              <Field label="Canonical URL (optional, https)"><Input disabled={!editable} value={fields.canonicalUrl} onChange={(e) => setFields({ ...fields, canonicalUrl: e.target.value })} /></Field>
              <Field label="Social title (optional)"><Input disabled={!editable} maxLength={160} value={fields.ogTitle} onChange={(e) => setFields({ ...fields, ogTitle: e.target.value })} /></Field>
              <Field label="Social description (optional)" className="sm:col-span-2"><Input disabled={!editable} maxLength={300} value={fields.ogDescription} onChange={(e) => setFields({ ...fields, ogDescription: e.target.value })} /></Field>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <span className="text-sm font-medium">Sections</span>
                {editable && (
                  <Select value="" onChange={(e) => addForm(e.target.value)} className="w-64">
                    <option value="">Embed a lead form…</option>
                    {(forms.data?.items ?? []).filter((f) => f.status === "PUBLISHED").map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                  </Select>
                )}
              </div>
              <Textarea rows={16} disabled={!editable} value={json} onChange={(e) => setJson(e.target.value)} className="font-mono text-xs" spellCheck={false} />
              {parseError && <p className="text-sm text-danger">{parseError}</p>}
              <p className="text-xs text-muted">Allowed section types: HERO, TEXT, BENEFITS, STEPS, FAQ, PROCESS_TRUST, CTA, FORM_EMBED, DISCLAIMER. Plain text only — markup, guarantees, perfect-match claims, urgency pressure and any religion, caste, income or appearance wording are rejected. A published page needs an embedded published form and a disclaimer.</p>
            </div>
            <div className="mt-3 rounded-lg border border-border bg-background p-3">
              <p className="mb-1 text-xs font-medium text-muted">Outline preview</p>
              <ol className="list-decimal space-y-0.5 ps-5 text-sm">{(parsed ? outline(parsed) : []).map((o, i) => <li key={i}>{o}</li>)}</ol>
            </div>
            {editable && can("marketing:landing_pages:edit") && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="What changed (optional)" className="min-w-64 flex-1"><Input maxLength={300} value={fields.changeSummary} onChange={(e) => setFields({ ...fields, changeSummary: e.target.value })} /></Field>
                <Button disabled={busy || !parsed || !fields.title} onClick={() => run("", "PATCH", saveBody(), "Draft saved.")}>Save draft</Button>
              </div>
            )}
            {!editable && can("marketing:landing_pages:edit") && (
              <div className="mt-3"><Button variant="outline" disabled={busy || !parsed} onClick={() => run("", "PATCH", saveBody(), "New draft version created.")}>Save as a new draft version</Button></div>
            )}
          </Card>

          {current.policyScanResult?.findings && current.policyScanResult.findings.length > 0 && (
            <Card title="Content policy findings (last scan)">
              <ul className="space-y-1 text-sm">{current.policyScanResult.findings.map((f, i) => <li key={i} className={f.severity === "BLOCK" ? "text-danger" : "text-warning"}>{f.severity === "BLOCK" ? "Blocked" : "Warning"}: {f.rule.replace(/_/g, " ").toLowerCase()} <span className="text-muted">({f.snippet})</span></li>)}</ul>
            </Card>
          )}

          <Card title="Review & publishing">
            <div className="space-y-3">
              <Field label="Reason / note"><Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex flex-wrap gap-2">
                {editable && can("marketing:landing_pages:edit") && <Button disabled={busy} onClick={() => run("/submit", "POST", { version: current.version }, "Submitted for review.")}>Submit for review</Button>}
                {current.status === "REVIEW" && can("marketing:approve") && (
                  <>
                    <Button disabled={busy} onClick={() => run("/review", "POST", { version: current.version, decision: "APPROVE", note: reason || undefined }, "Version approved.")}>Approve</Button>
                    <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => run("/review", "POST", { version: current.version, decision: "REJECT", note: reason }, "Version rejected.")}>Reject</Button>
                  </>
                )}
                {current.status === "APPROVED" && can("marketing:landing_pages:publish") && <Button disabled={busy || !reason.trim()} onClick={() => run("/publish", "POST", { version: current.version, reason }, "Publish processed.")}>Publish this version</Button>}
                {page.status === "PUBLISHED" && can("marketing:landing_pages:unpublish") && <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => run("/unpublish", "POST", { reason }, "Page unpublished.")}>Unpublish</Button>}
                {current.status !== "DRAFT" && can("marketing:landing_pages:rollback") && <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => run("/rollback", "POST", { fromVersion: current.version, reason }, "Earlier version copied forward as a new draft.")}>Roll back to this version (as new draft)</Button>}
                {page.status !== "PUBLISHED" && page.status !== "ARCHIVED" && can("marketing:landing_pages:unpublish") && <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => run("/archive", "POST", { reason }, "Page archived.")}>Archive</Button>}
              </div>
              <p className="text-xs text-muted">Rolling back never edits history: the chosen version is copied forward as a new draft that is checked against the current policy and must be reviewed and published again. Publishing may need an independent approval; you will be told if it does.</p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
