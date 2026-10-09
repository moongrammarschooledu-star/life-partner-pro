"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Card, ErrorNote, KV, Loading, StatusBadge, useApi } from "@/components/admin/system/shared";
import { SocHeader, Source, Stat, Table, fmt, makeCan } from "@/components/admin/soc/shared";

interface Data {
  mfa: { privilegedTotal: number; covered: number; gaps: Array<{ adminId: string; name: string; role: string; reason: string }>; policy: { enforceMfaPrivileged: boolean; requiredRoles: string[] }; note: string };
  sessions: Array<{ id: string; adminName: string; role: string; device: string | null; ip: string | null; lastActiveAt: string; createdAt: string }>;
  privilegeChanges: Array<{ id: string; action: string; actorId: string | null; targetId: string | null; at: string }>;
  breakGlass: Array<{ id: string; adminId: string; recordType: string; grantedAt: string; expiresAt: string; used: boolean; reason: string }>;
  logins: { days: number; success: number; failure: number; locked: number };
  policy: { sessionIdleMinutes: number | null; maxConcurrentSessions: number | null; stepUpForHighRisk: boolean; enforceMfaPrivileged: boolean };
}

export function AdminSecurityClient({ permissions }: { permissions: string[] }) {
  const can = makeCan(permissions);
  const { data, error, loading } = useApi<Data>("/api/admin/soc/admin-security");
  return (
    <div className="space-y-4">
      <SocHeader title="Administrator security" description="Who is protected by a second step, which sessions are live, who changed privileges and who used emergency access. Privileges can only be granted by someone with the right to grant them — nobody can raise their own." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Privileged administrators" value={data.mfa.privilegedTotal} />
            <Stat label="Without a second step" value={data.mfa.gaps.length} tone={data.mfa.gaps.length ? "warning" : "success"} />
            <Stat label={`Sign-ins failed (${data.logins.days} days)`} value={data.logins.failure} hint={`${data.logins.success} succeeded · ${data.logins.locked} locked`} />
            <Stat label="Live sessions" value={data.sessions.length} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Second-step coverage">
              <p className="mb-2 text-sm text-muted">{data.mfa.note}</p>
              {data.mfa.gaps.length === 0 ? <EmptyState title="Every privileged administrator is covered" /> : (
                <Table head={["Administrator", "Role", "Why"]}>{data.mfa.gaps.map((g) => <tr key={g.adminId}><td className="px-2 py-2">{g.name}</td><td className="px-2 py-2 text-muted">{g.role}</td><td className="px-2 py-2 text-muted">{g.reason}</td></tr>)}</Table>
              )}
              <p className="mt-3 text-xs text-muted">Enforcement for privileged roles is {data.policy.enforceMfaPrivileged ? "ON" : "off"}. Change it in Configuration. Roles already on the existing “required roles” list: {data.mfa.policy.requiredRoles.join(", ") || "none"}.</p>
            </Card>
            <Card title="Session policy">
              <dl>
                <KV label="Idle timeout">{data.policy.sessionIdleMinutes ? `${data.policy.sessionIdleMinutes} minutes` : "Not set"}</KV>
                <KV label="Concurrent session cap">{data.policy.maxConcurrentSessions ?? "Not set"}</KV>
                <KV label="Password re-entry for high-risk actions">{data.policy.stepUpForHighRisk ? "Required" : "Off"}</KV>
              </dl>
              <p className="mt-2 text-xs text-muted">To end a session during an attack, request containment from the incident; the existing session-revoke action in Admin Users also remains available to a Super Admin.</p>
            </Card>
          </div>
          <Card title="Live administrator sessions">
            {data.sessions.length === 0 ? <EmptyState title="No live sessions" /> : (
              <Table head={["Administrator", "Role", "Device", "Address", "Last active", "Signed in"]}>
                {data.sessions.map((s) => <tr key={s.id}><td className="px-2 py-2">{s.adminName}</td><td className="px-2 py-2 text-muted">{s.role}</td><td className="px-2 py-2 text-muted">{s.device ?? "—"}</td><td className="px-2 py-2 text-muted">{s.ip ?? "—"}</td><td className="px-2 py-2 text-muted">{fmt(s.lastActiveAt)}</td><td className="px-2 py-2 text-muted">{fmt(s.createdAt)}</td></tr>)}
              </Table>
            )}
            <Source>AdminSession (addresses shortened)</Source>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Privilege changes (30 days)">
              {data.privilegeChanges.length === 0 ? <EmptyState title="No privilege changes recorded" /> : (
                <Table head={["Change", "By", "Target", "When"]}>{data.privilegeChanges.map((c) => <tr key={c.id}><td className="px-2 py-2">{c.action.replace(/_/g, " ").toLowerCase()}</td><td className="px-2 py-2 text-muted">{c.actorId ?? "system"}</td><td className="px-2 py-2 text-muted">{c.targetId ?? "—"}</td><td className="px-2 py-2 text-muted">{fmt(c.at)}</td></tr>)}</Table>
              )}
              <Source>AuditLog</Source>
            </Card>
            <Card title="Break-glass (emergency) access (90 days)">
              {data.breakGlass.length === 0 ? <EmptyState title="No emergency access granted" /> : (
                <Table head={["Administrator", "For", "Granted", "Used", "Reason"]}>{data.breakGlass.map((b) => <tr key={b.id}><td className="px-2 py-2">{b.adminId}</td><td className="px-2 py-2 text-muted">{b.recordType.toLowerCase()}</td><td className="px-2 py-2 text-muted">{fmt(b.grantedAt)}</td><td className="px-2 py-2"><StatusBadge status={b.used ? "COMPLETED" : "PENDING"} /></td><td className="px-2 py-2 text-muted">{b.reason}</td></tr>)}</Table>
              )}
              <Source>BreakGlassAccess — every use is reviewed by a detection rule</Source>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
