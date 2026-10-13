"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { CcHeader, Source, Stat, StatusPill, fmt } from "@/components/admin/platform/cc-shared";

type Unavailable = { unavailable: true };
type Maybe<T> = T | Unavailable;
const isUnavailable = (v: unknown): v is Unavailable => typeof v === "object" && v !== null && (v as Unavailable).unavailable === true;
const val = (v: unknown): string | number => (isUnavailable(v) || v === null || v === undefined ? "Unavailable" : (v as string | number));

interface Overview {
  generatedAt: string;
  environment: string;
  sections: string[];
  navigation: Array<{ key: string; label: string; group: string; href: string }>;
  platform?: { source: string; status: Maybe<string>; version: Maybe<string>; commit: Maybe<string>; deploymentStatus: Maybe<string>; maintenance: Maybe<{ kind: string; active: boolean }>; activeAdminSessions: Maybe<number>; changeFreeze: Maybe<{ active: boolean; endsAt?: string | null; reason?: string }>; breakGlassAwaitingReview: Maybe<number>; health: Maybe<string> };
  security?: Maybe<{ source: string; openAlerts: number; criticalAndHighAlerts: number; openIncidents: number; failedLogins24h: number; adminSecurityEvents24h: number; suspiciousActivity24h: number; twoFactor: { privilegedAdmins: number; gaps: number; enforcedForPrivileged: boolean } }>;
  operations?: { source: string; pendingTasks: Maybe<number>; pendingApprovals: Maybe<number>; pendingVerification: Maybe<number>; pendingProposals: Maybe<number>; pendingSupportCases: Maybe<number>; overdueFollowUps: Maybe<number> };
  business?: { source: string; applicants: Maybe<number>; activeProfiles: Maybe<number>; matches: Maybe<number>; proposals: Maybe<number>; meetings: Maybe<number>; activeMemberships: Maybe<number>; revenueLast30Days: Maybe<Array<{ currency: string; amountMinor: number; payments: number }>> };
  infrastructure?: Maybe<{ source: string; items: Array<{ label: string; status: string; detail: string }>; note: string }>;
  deployment?: Maybe<{ source: string; version: string; commit: string; environment: string; deployedAt: string | null; migrationCount: number | null; lastMigration: string | null; lastBackup: { status?: string; startedAt?: string } | null; lastVerifiedBackup: { startedAt?: string } | null; lastRestoreTest: { status?: string; startedAt?: string } | null; lastRestoreDrill: { status?: string; startedAt?: string } | null; health: string }>;
}

interface Hit { type: string; key: string; label: string; category: string; status?: string; href: string }

// Searches keys, labels, categories, providers, features and statuses you may see. Stored values are never searched.
function ConfigSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/admin/platform/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items: Hit[] }) => !cancelled && setHits(j.items))
        .catch(() => !cancelled && setHits([]));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);
  const shown = q.trim().length < 2 ? null : hits;
  return (
    <Card title="Search configuration">
      <Input aria-label="Search settings, features, providers and areas" placeholder="Search settings, features, providers, areas…" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown && (
        <ul className="mt-3 divide-y divide-border text-sm">
          {shown.length === 0 ? <li className="py-2 text-muted">Nothing matches.</li> : shown.map((h) => (
            <li key={`${h.type}:${h.key}`} className="flex items-center justify-between gap-3 py-2"><Link href={h.href} className="text-primary hover:underline">{h.label}</Link><span className="text-xs text-muted">{h.type} · {h.category}{h.status ? ` · ${h.status.toLowerCase().replace(/_/g, " ")}` : ""}</span></li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ControlCenterOverview({ permissions }: { permissions: string[] }) {
  const { data, error, loading } = useApi<Overview>("/api/admin/control-center");
  const groups = data ? Array.from(new Set(data.navigation.map((n) => n.group))) : [];
  return (
    <div className="space-y-4">
      <CcHeader title="Super Admin Control Center" description="Where platform-wide configuration, feature rollout, providers, maintenance and platform health are governed. Each area keeps its own editor; this is the place to see the whole platform, change what is shared, and read the history." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <ConfigSearch />
          {data.platform && (
            <Card title="Platform">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Status" value={isUnavailable(data.platform.status) ? "Unavailable" : String(data.platform.status).replace(/_/g, " ").toLowerCase()} tone={data.platform.status === "OPERATIONAL" ? "success" : data.platform.status === "READ_ONLY" ? "warning" : "danger"} />
                <Stat label="Version / commit" value={`${val(data.platform.version)}`} hint={`commit ${val(data.platform.commit)}`} />
                <Stat label="Deployment" value={String(val(data.platform.deploymentStatus)).toLowerCase()} />
                <Stat label="Health" value={String(val(data.platform.health)).toLowerCase()} />
                <Stat label="Maintenance" value={isUnavailable(data.platform.maintenance) ? "Unavailable" : data.platform.maintenance.kind.replace(/_/g, " ").toLowerCase()} hint={isUnavailable(data.platform.maintenance) ? undefined : data.platform.maintenance.active ? "in effect" : "not in effect"} />
                <Stat label="Administrator sessions" value={val(data.platform.activeAdminSessions)} />
                <Stat label="Change freeze" value={isUnavailable(data.platform.changeFreeze) ? "Unavailable" : data.platform.changeFreeze.active ? "Active" : "Off"} tone={!isUnavailable(data.platform.changeFreeze) && data.platform.changeFreeze.active ? "warning" : undefined} hint={!isUnavailable(data.platform.changeFreeze) && data.platform.changeFreeze.active ? `until ${fmt(data.platform.changeFreeze.endsAt)}` : undefined} />
                <Stat label="Break-glass uses awaiting review" value={val(data.platform.breakGlassAwaitingReview)} tone={typeof data.platform.breakGlassAwaitingReview === "number" && data.platform.breakGlassAwaitingReview > 0 ? "warning" : undefined} />
              </div>
              <Source at={data.generatedAt}>{data.platform.source}</Source>
            </Card>
          )}

          {data.security !== undefined && (
            <Card title="Security">
              {isUnavailable(data.security) ? <p className="text-sm text-muted">Unavailable right now.</p> : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Open alerts" value={data.security.openAlerts} />
                    <Stat label="Critical and high" value={data.security.criticalAndHighAlerts} tone={data.security.criticalAndHighAlerts > 0 ? "danger" : undefined} />
                    <Stat label="Open incidents" value={data.security.openIncidents} />
                    <Stat label="Failed sign-ins (24 h)" value={data.security.failedLogins24h} />
                    <Stat label="Administrator security events (24 h)" value={data.security.adminSecurityEvents24h} />
                    <Stat label="Suspicious activity signals (24 h)" value={data.security.suspiciousActivity24h} />
                    <Stat label="Privileged admins without two-factor" value={data.security.twoFactor.gaps} hint={`of ${data.security.twoFactor.privilegedAdmins}`} tone={data.security.twoFactor.gaps > 0 ? "warning" : undefined} />
                  </div>
                  <Source at={data.generatedAt}>{data.security.source}</Source>
                </>
              )}
            </Card>
          )}

          {data.operations && (
            <Card title="Operations">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label="Pending tasks" value={val(data.operations.pendingTasks)} />
                <Stat label="Pending approvals" value={val(data.operations.pendingApprovals)} />
                <Stat label="Pending verification" value={val(data.operations.pendingVerification)} />
                <Stat label="Pending proposals" value={val(data.operations.pendingProposals)} />
                <Stat label="Open support cases" value={val(data.operations.pendingSupportCases)} />
                <Stat label="Overdue follow-ups" value={val(data.operations.overdueFollowUps)} />
              </div>
              <Source at={data.generatedAt}>{data.operations.source}</Source>
            </Card>
          )}

          {data.business && (
            <Card title="Business">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Applicants" value={val(data.business.applicants)} />
                <Stat label="Active profiles" value={val(data.business.activeProfiles)} />
                <Stat label="Matches" value={val(data.business.matches)} />
                <Stat label="Proposals" value={val(data.business.proposals)} />
                <Stat label="Meetings" value={val(data.business.meetings)} />
                <Stat label="Active memberships" value={val(data.business.activeMemberships)} />
              </div>
              <div className="mt-3 text-sm">
                <p className="text-xs text-muted">Revenue in the last 30 days (paid, per currency)</p>
                {isUnavailable(data.business.revenueLast30Days) ? <p className="text-muted">Unavailable</p> : data.business.revenueLast30Days.length === 0 ? <p className="text-muted">No paid payments yet.</p> : data.business.revenueLast30Days.map((r) => <p key={r.currency}>{r.currency} {(r.amountMinor / 100).toLocaleString()} · {r.payments} payment(s)</p>)}
              </div>
              <Source at={data.generatedAt}>{data.business.source}</Source>
            </Card>
          )}

          {data.infrastructure !== undefined && (
            <Card title="Infrastructure">
              {isUnavailable(data.infrastructure) ? <p className="text-sm text-muted">Unavailable right now.</p> : (
                <>
                  <ul className="grid gap-2 md:grid-cols-2">
                    {data.infrastructure.items.map((i) => <li key={i.label} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2 text-sm"><span>{i.label}</span><span className="flex items-center gap-2"><span className="text-xs text-muted">{i.detail}</span><StatusPill status={i.status} /></span></li>)}
                  </ul>
                  <p className="mt-2 text-xs text-muted">{data.infrastructure.note}</p>
                  <Source at={data.generatedAt}>{data.infrastructure.source}</Source>
                </>
              )}
            </Card>
          )}

          {data.deployment !== undefined && (
            <Card title="Deployment">
              {isUnavailable(data.deployment) ? <p className="text-sm text-muted">Unavailable right now.</p> : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Version" value={data.deployment.version} hint={`commit ${data.deployment.commit}`} />
                    <Stat label="Migrations applied" value={data.deployment.migrationCount ?? "Unavailable"} hint={data.deployment.lastMigration ?? undefined} />
                    <Stat label="Last backup" value={data.deployment.lastBackup?.status?.toLowerCase() ?? "none yet"} hint={fmt(data.deployment.lastBackup?.startedAt)} />
                    <Stat label="Last verified backup" value={data.deployment.lastVerifiedBackup ? fmt(data.deployment.lastVerifiedBackup.startedAt) : "none yet"} />
                    <Stat label="Last restore test" value={data.deployment.lastRestoreTest?.status?.toLowerCase() ?? "none yet"} hint={fmt(data.deployment.lastRestoreTest?.startedAt)} />
                    <Stat label="Last restore drill" value={data.deployment.lastRestoreDrill?.status?.toLowerCase() ?? "none yet"} hint={fmt(data.deployment.lastRestoreDrill?.startedAt)} />
                  </div>
                  <Source at={data.generatedAt}>{data.deployment.source}</Source>
                </>
              )}
            </Card>
          )}

          <Card title="All areas">
            {groups.length === 0 ? <EmptyState title="Nothing to show" description="Your role has no Control Center areas." /> : groups.map((g) => (
              <div key={g} className="mb-3">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g}</p>
                <ul className="flex flex-wrap gap-2">
                  {data.navigation.filter((n) => n.group === g).map((n) => <li key={n.key}><Link href={n.href} className="inline-block rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-muted">{n.label}</Link></li>)}
                </ul>
              </div>
            ))}
          </Card>
          <p className="text-xs text-muted"><Badge variant="muted">note</Badge> A figure shows &quot;Unavailable&quot; when it could not be read; it is never estimated. Sections are shown only for the permissions your role holds.</p>
        </>
      )}
    </div>
  );
}
