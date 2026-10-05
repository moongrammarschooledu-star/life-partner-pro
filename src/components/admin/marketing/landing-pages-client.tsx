"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, StatusBadge, timeAgo, useApi } from "@/components/admin/system/shared";
import { act } from "@/components/admin/marketing/shared";
import { STARTER_SECTIONS } from "@/components/admin/marketing/landing-starter";

interface PageRow { id: string; code: string; slug: string; name: string; status: string; language: string; noindex: boolean; sitemapInclude: boolean; latestVersion: { version: number; status: string } | null; updatedAt: string }

export function LandingPagesClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: PageRow[] }>("/api/admin/marketing/landing-pages");
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: "", slug: "", title: "", language: "EN" });

  async function create() {
    const ok = await act(show, "/api/admin/marketing/landing-pages", "POST", { ...f, sections: STARTER_SECTIONS(f.language === "UR" ? "UR" : "EN"), noindex: true, sitemapInclude: false, changeSummary: "Initial draft from starter template" }, "Landing page created as a draft.");
    if (ok) { setCreating(false); setF({ name: "", slug: "", title: "", language: "EN" }); reload(); }
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/marketing" className="text-sm text-primary hover:underline">← Marketing Center</Link>
        <h1 className="mt-1 text-xl font-semibold">Landing pages</h1>
        <p className="text-sm text-muted">Pages are built from structured sections (no raw HTML), reviewed by a second person, and published as an immutable version. New pages are hidden from search engines until you choose otherwise.</p>
      </div>
      {can("marketing:landing_pages:create") && <Button onClick={() => setCreating((c) => !c)}>{creating ? "Cancel" : "New landing page"}</Button>}
      {creating && (
        <Card title="New landing page">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Internal name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Address (/lp/…)"><Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
            <Field label="Page title"><Input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
          </div>
          <p className="mt-2 text-xs text-muted">Starts from a neutral template with a headline, how-it-works steps, FAQ and the required disclaimer. Edit it in the editor, link a published lead form, then submit it for review.</p>
          <div className="mt-3"><Button onClick={create} disabled={!f.name || !f.slug || !f.title}>Create draft</Button></div>
        </Card>
      )}
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : !data || data.items.length === 0 ? <EmptyState title="No landing pages yet" /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-3">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Page</th><th className="pb-2">Address</th><th className="pb-2">Status</th><th className="pb-2">Latest version</th><th className="pb-2">Search</th><th className="pb-2">Updated</th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2"><Link className="font-medium text-primary hover:underline" href={`/admin/marketing/landing-pages/${p.id}`}>{p.name}</Link><div className="font-mono text-xs text-muted">{p.code}</div></td>
                  <td className="py-2 font-mono text-xs">/lp/{p.slug}</td>
                  <td className="py-2"><StatusBadge status={p.status} /></td>
                  <td className="py-2">{p.latestVersion ? <span>v{p.latestVersion.version} <StatusBadge status={p.latestVersion.status} /></span> : "—"}</td>
                  <td className="py-2 text-xs text-muted">{p.noindex ? "hidden" : p.sitemapInclude ? "indexed + sitemap" : "indexed"}</td>
                  <td className="py-2 text-muted">{timeAgo(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
