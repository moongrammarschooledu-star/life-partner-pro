"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { CcHeader, Source, Stat, StatusPill, Table, fmt } from "@/components/admin/platform/cc-shared";

interface Health {
  environment: string;
  overall: string;
  generatedAt: string;
  checks: Array<{ key: string; status: string; detail: string }>;
  providers: Array<{ key: string; label: string; status: string; lastCheckedAt: string | null }>;
}

export function HealthClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading, reload } = useApi<Health>("/api/admin/platform/health");
  return (
    <div className="space-y-4">
      <CcHeader title="System health" description="Application, database, storage, queue, e-mail, payments, authentication, background jobs and webhooks, in one vocabulary. Checks run when you open or refresh this page; there is no continuous monitor behind it." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title="Checks" action={<Button size="sm" variant="outline" onClick={reload}>Refresh</Button>}>
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Overall" value={data.overall.toLowerCase()} tone={data.overall === "healthy" || data.overall === "ok" ? "success" : "warning"} /></div>
            <Table head={["Check", "Status", "Detail"]}>{data.checks.map((c) => <tr key={c.key}><td className="px-2 py-2 capitalize">{c.key.replace(/_/g, " ")}</td><td className="px-2 py-2"><StatusPill status={c.status} /></td><td className="px-2 py-2 text-muted">{c.detail}</td></tr>)}</Table>
            <Source at={data.generatedAt}>the platform health checks (database round trip, storage, queue, configuration presence)</Source>
          </Card>
          <Card title="Providers" action={<Link href="/admin/control-center/providers" className="text-sm text-primary hover:underline">Providers and tests</Link>}>
            <Table head={["Provider", "Status", "Last tested"]} empty={data.providers.length === 0 ? "No providers to show." : undefined}>
              {data.providers.map((p) => <tr key={p.key}><td className="px-2 py-2">{p.label}</td><td className="px-2 py-2"><StatusPill status={p.status} /></td><td className="px-2 py-2 text-muted">{fmt(p.lastCheckedAt)}</td></tr>)}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
