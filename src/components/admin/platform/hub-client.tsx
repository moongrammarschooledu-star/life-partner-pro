"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { CcHeader, Source, Table, fmt } from "@/components/admin/platform/cc-shared";

interface Hub {
  section: { key: string; label: string; group: string; description: string };
  links: Array<{ label: string; href: string }>;
  summary: { rows: Array<{ label: string; value: string | number | boolean | null }>; problems: string[]; table?: { columns: string[]; rows: Array<Array<string | number>> } } | null;
  recentChanges: Array<{ id: string; kind: string; key: string; version: number; createdAt: string; reason: string }>;
}

// A section hub: a read-only summary of one existing area's configuration plus links to the screen where it is edited. There is nothing to change here, on
// purpose: the area's own editor keeps its validation, permissions and approvals.
export function SectionHub({ sectionKey, permissions }: { sectionKey: string; permissions: string[] }) {
  const { data, error, loading, updatedAt } = useApi<Hub>(`/api/admin/control-center/sections/${encodeURIComponent(sectionKey)}`);
  return (
    <div className="space-y-4">
      <CcHeader title={data?.section.label ?? "Control Center"} description={data?.section.description ?? "Loading…"} permissions={permissions} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title="Where this is edited">
            {data.links.length === 0 ? <p className="text-sm text-muted">No editor is available for your role.</p> : (
              <ul className="flex flex-wrap gap-2">{data.links.map((l) => <li key={l.href}><Link href={l.href} className="inline-block rounded-lg border border-border px-3 py-1.5 text-sm text-primary hover:bg-surface-muted">{l.label} →</Link></li>)}</ul>
            )}
            <p className="mt-2 text-xs text-muted">Changes are made in that screen, with its own checks and approvals. This page only shows the current configuration.</p>
          </Card>
          {data.summary ? (
            <Card title="Current configuration">
              {data.summary.problems.length > 0 && (
                <ul className="mb-3 space-y-1 rounded-lg border border-border bg-surface-muted p-3 text-sm">{data.summary.problems.map((p) => <li key={p}>⚠ {p}</li>)}</ul>
              )}
              {data.summary.rows.length === 0 && !data.summary.table ? <EmptyState title="Nothing to show yet" /> : (
                <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2">
                  {data.summary.rows.map((r) => (
                    <div key={r.label} className="flex items-start justify-between gap-3 border-b border-border py-1.5 text-sm"><dt className="text-muted">{r.label}</dt><dd className="text-right font-medium">{r.value === null ? "Unavailable" : typeof r.value === "boolean" ? (r.value ? "Yes" : "No") : String(r.value)}</dd></div>
                  ))}
                </dl>
              )}
              {data.summary.table && (
                <div className="mt-4">
                  <Table head={data.summary.table.columns}>{data.summary.table.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className="px-2 py-2">{c}</td>)}</tr>)}</Table>
                </div>
              )}
              <Source at={updatedAt}>this area&apos;s own tables, read just now</Source>
            </Card>
          ) : (
            <Card title="Current configuration"><p className="text-sm text-muted">This area is managed entirely in its own screens. Use the links above.</p></Card>
          )}
          {data.recentChanges.length > 0 && (
            <Card title="Recent platform changes" action={<Link href="/admin/control-center/configuration-history" className="text-sm text-primary hover:underline">All history</Link>}>
              <Table head={["Item", "Version", "Reason", "When"]}>{data.recentChanges.map((c) => <tr key={c.id}><td className="px-2 py-2">{c.key}</td><td className="px-2 py-2 text-muted">v{c.version}</td><td className="px-2 py-2 text-muted">{c.reason}</td><td className="px-2 py-2 text-muted">{fmt(c.createdAt)}</td></tr>)}</Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
