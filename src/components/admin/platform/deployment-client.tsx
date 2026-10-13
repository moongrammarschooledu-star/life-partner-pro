"use client";

import Link from "next/link";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { CcHeader, Source, Stat, fmt } from "@/components/admin/platform/cc-shared";

type Unavailable = { unavailable: true };
interface Dep {
  source: string; version: string; commit: string; environment: string; deployedAt: string | null; migrationCount: number | null; lastMigration: string | null;
  lastBackup: { status?: string; startedAt?: string } | null; lastVerifiedBackup: { startedAt?: string } | null; lastRestoreTest: { status?: string; startedAt?: string } | null; lastRestoreDrill: { status?: string; startedAt?: string } | null; health: string;
}
interface Data { generatedAt: string; environment: string; deployment?: Dep | Unavailable }

export function DeploymentClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading } = useApi<Data>("/api/admin/control-center");
  const d = data?.deployment && !("unavailable" in data.deployment) ? data.deployment : null;
  return (
    <div className="space-y-4">
      <CcHeader title="Deployment" description="What is running, whether the database is up to date, and when it was last backed up and restored. This page is read-only: no command, deployment or migration can be started from here." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && !d && <p className="text-sm text-muted">Deployment details are unavailable right now.</p>}
      {data && d && (
        <Card title="Running release">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Version" value={d.version} hint={`commit ${d.commit}`} />
            <Stat label="Environment" value={d.environment.toLowerCase()} />
            <Stat label="Deployed" value={fmt(d.deployedAt)} />
            <Stat label="Health" value={d.health.toLowerCase()} />
            <Stat label="Migrations applied" value={d.migrationCount ?? "Unavailable"} hint={d.lastMigration ?? undefined} />
            <Stat label="Last backup" value={d.lastBackup?.status?.toLowerCase() ?? "none yet"} hint={fmt(d.lastBackup?.startedAt)} />
            <Stat label="Last verified backup" value={d.lastVerifiedBackup ? fmt(d.lastVerifiedBackup.startedAt) : "none yet"} />
            <Stat label="Last restore test / drill" value={d.lastRestoreTest?.status?.toLowerCase() ?? "none yet"} hint={d.lastRestoreDrill ? `drill: ${d.lastRestoreDrill.status?.toLowerCase()} ${fmt(d.lastRestoreDrill.startedAt)}` : "no drill yet"} />
          </div>
          <Source at={data.generatedAt}>{d.source}</Source>
          <p className="mt-3 text-sm text-muted">Go-live gates and release approval are in <Link href="/admin/deployment" className="text-primary hover:underline">Deployment &amp; Go-Live</Link>.</p>
        </Card>
      )}
    </div>
  );
}
