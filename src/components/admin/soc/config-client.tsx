"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, SensitiveActionDialog, callApi, useApi } from "@/components/admin/system/shared";
import { SocHeader, Source, Table, fmt, makeCan } from "@/components/admin/soc/shared";

const LABELS: Record<string, { label: string; hint: string; kind: "number" | "boolean"; nullable?: boolean }> = {
  escalateCriticalMinutes: { label: "Escalate unacknowledged CRITICAL alerts after (minutes)", hint: "0 = never", kind: "number" },
  escalateHighMinutes: { label: "Escalate unacknowledged HIGH alerts after (minutes)", hint: "0 = never", kind: "number" },
  escalateMediumMinutes: { label: "Escalate unacknowledged MEDIUM alerts after (minutes)", hint: "0 = never", kind: "number" },
  suppressionWindowMinutes: { label: "Quiet period after an alert is closed (minutes)", hint: "The same finding is not raised again inside it", kind: "number" },
  sessionIdleMinutes: { label: "End idle administrator sessions after (minutes)", hint: "Empty = no idle timeout", kind: "number", nullable: true },
  maxConcurrentSessions: { label: "Most sessions one administrator may hold", hint: "Empty = no limit; a new sign-in ends the oldest", kind: "number", nullable: true },
  stepUpForHighRisk: { label: "Ask for the password again on high-risk actions", hint: "Containment approval, rule changes, configuration", kind: "boolean" },
  enforceMfaPrivileged: { label: "Require the one-time code for privileged administrators", hint: "At every sign-in; off until you switch it on", kind: "boolean" },
  accessLogRetentionDays: { label: "Keep the access log for (days)", hint: "30–3650", kind: "number" },
  alertRetentionDays: { label: "Keep closed alerts that are not part of an incident for (days)", hint: "90–3650", kind: "number" },
};

export function ConfigClient({ permissions }: { permissions: string[] }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ version: number; settings: Record<string, number | boolean | null>; history: Array<{ id: string; version: number; changes: Record<string, { from: unknown; to: unknown }>; reason: string; authorId: string; createdAt: string }> }>("/api/admin/soc/configuration");
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  function changes(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(edit)) {
      const meta = LABELS[k];
      if (!meta || !data) continue;
      const v = meta.kind === "boolean" ? raw === "true" : raw.trim() === "" ? null : Number(raw);
      if (v !== data.settings[k]) out[k] = v;
    }
    return out;
  }
  const pending = Object.keys(changes()).length;

  return (
    <div className="space-y-4">
      <SocHeader title="Security configuration" description="Every change here is saved as a new version with the reason and who made it, and asks for your password. Alert thresholds, rate limits, backup retention and the two-factor role list live in System Control and Settings and are not duplicated here." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title={`Current settings — version ${data.version}`}>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(LABELS).map(([k, m]) => {
                const cur = data.settings[k];
                const val = edit[k] ?? (cur === null ? "" : String(cur));
                return (
                  <Field key={k} label={m.label} hint={m.hint} htmlFor={`cfg-${k}`}>
                    {m.kind === "boolean" ? (
                      <select id={`cfg-${k}`} disabled={!can("soc:config:manage")} className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm" value={val} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}><option value="true">On</option><option value="false">Off</option></select>
                    ) : (
                      <Input id={`cfg-${k}`} type="number" disabled={!can("soc:config:manage")} value={val} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} />
                    )}
                  </Field>
                );
              })}
            </div>
            {can("soc:config:manage") && <div className="mt-4 flex items-center gap-3"><Button onClick={() => setConfirm(true)} disabled={pending === 0}>Save {pending ? `${pending} change(s)` : "changes"}</Button>{pending > 0 && <Button variant="ghost" onClick={() => setEdit({})}>Discard</Button>}</div>}
            <p className="mt-3 text-sm text-muted">Related settings elsewhere: <Link className="text-primary hover:underline" href="/admin/system-config">System Control</Link> (thresholds, backup retention, recovery objectives) · <Link className="text-primary hover:underline" href="/admin/settings">Settings</Link> (two-factor roles).</p>
          </Card>
          <Card title="Change history">
            {data.history.length === 0 ? <EmptyState title="No changes yet" description="The settings are at their defaults." /> : (
              <Table head={["Version", "What changed", "Why", "By", "When"]}>
                {data.history.map((h) => <tr key={h.id} className="align-top"><td className="px-2 py-2">v{h.version}</td><td className="px-2 py-2 text-muted">{Object.entries(h.changes).map(([k, c]) => `${LABELS[k]?.label ?? k}: ${String(c.from ?? "off")} → ${String(c.to ?? "off")}`).join("; ")}</td><td className="px-2 py-2 text-muted">{h.reason}</td><td className="px-2 py-2 text-muted">{h.authorId}</td><td className="px-2 py-2 text-muted">{fmt(h.createdAt)}</td></tr>)}
              </Table>
            )}
            <Source>SocConfigVersion</Source>
          </Card>
        </>
      )}
      <SensitiveActionDialog
        open={confirm}
        title="Save the security configuration"
        description="This creates a new version of the configuration and is recorded in the audit log."
        onCancel={() => setConfirm(false)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const res = await callApi("/api/admin/soc/configuration", "PATCH", { changes: changes(), reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "The change was not saved.";
          show("Configuration saved.", "success");
          setConfirm(false);
          setEdit({});
          reload();
        }}
      />
    </div>
  );
}

export function AuditClient({ permissions }: { permissions: string[] }) {
  const can = makeCan(permissions);
  const { data, error, loading } = useApi<{ access: Array<{ id: string; adminId: string; action: string; resource: string; resourceId: string | null; outcome: string; createdAt: string }>; changes: Array<{ id: string; action: string; adminId: string | null; createdAt: string }> }>("/api/admin/soc/audit");
  return (
    <div className="space-y-4">
      <SocHeader title="Security operations audit" description="Who opened which security screen, and every change made in Security Operations. Neither list contains the data that was shown." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Changes">
            {data.changes.length === 0 ? <EmptyState title="Nothing recorded yet" /> : <Table head={["Change", "By", "When"]}>{data.changes.map((c) => <tr key={c.id}><td className="px-2 py-2">{c.action.replace(/^SOC_/, "").replace(/_/g, " ").toLowerCase()}</td><td className="px-2 py-2 text-muted">{c.adminId ?? "system"}</td><td className="px-2 py-2 text-muted">{fmt(c.createdAt)}</td></tr>)}</Table>}
            <Source>AuditLog</Source>
          </Card>
          <Card title="Screen access">
            {data.access.length === 0 ? <EmptyState title="Nothing recorded yet" /> : <Table head={["Who", "What", "Result", "When"]}>{data.access.map((a) => <tr key={a.id}><td className="px-2 py-2 text-muted">{a.adminId}</td><td className="px-2 py-2">{a.action.toLowerCase()} {a.resource}{a.resourceId ? ` ${a.resourceId}` : ""}</td><td className="px-2 py-2 text-muted">{a.outcome.toLowerCase()}</td><td className="px-2 py-2 text-muted">{fmt(a.createdAt)}</td></tr>)}</Table>}
            <Source>SocAccessLog</Source>
          </Card>
        </div>
      )}
    </div>
  );
}
