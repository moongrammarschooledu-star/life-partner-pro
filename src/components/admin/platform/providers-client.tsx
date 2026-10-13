"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, callApi, useApi } from "@/components/admin/system/shared";
import { ApprovalNote, ChangeDialog, CcHeader, Source, StatusPill, Table, fmt, sendChange } from "@/components/admin/platform/cc-shared";

interface Provider {
  key: string;
  category: string;
  categoryLabel: string;
  label: string;
  status: string;
  environment: string;
  enabledFeatures: string[];
  notes: string;
  manageHref: string | null;
  testable: boolean;
  lastCheck: { outcome: string; checkedAt: string; latencyMs: number | null } | null;
  lastSuccessAt: string | null;
}
interface Providers { environment: string; statuses: string[]; items: Provider[]; canManage: boolean }
interface TestResult { providerKey: string; outcome: string; status: string; latencyMs: number | null; detail: string }
interface History { history: Array<{ id: string; outcome: string; health: string; latencyMs: number | null; detail: string | null; checkedAt: string }> }

export function ProvidersClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading, reload } = useApi<Providers>("/api/admin/platform/providers");
  const { show } = useToast();
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [toggle, setToggle] = useState<{ p: Provider; active: boolean } | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const hist = useApi<History>(history ? `/api/admin/platform/providers/${encodeURIComponent(history)}` : null);

  async function runTest(p: Provider) {
    setTesting(p.key);
    const res = await callApi<TestResult>(`/api/admin/platform/providers/${encodeURIComponent(p.key)}/test`, "POST", {});
    setTesting(null);
    if (!res.ok) { show(res.data.error ?? "The test could not be run.", "error"); return; }
    setResults((r) => ({ ...r, [p.key]: res.data }));
    reload();
  }

  const categories = Array.from(new Set((data?.items ?? []).map((i) => i.categoryLabel)));
  return (
    <div className="space-y-4">
      <CcHeader title="Providers" description="Every outside service in one status vocabulary. A test only reads: it sends no message, charges nothing and changes nothing. No credential, key or secret name is ever shown here." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {approval && <ApprovalNote code={approval} onClose={() => setApproval(null)} />}
      {data && categories.map((c) => (
        <Card key={c} title={c}>
          <Table head={["Provider", "Status", "Last check", "Used for", ""]}>
            {data.items.filter((p) => p.categoryLabel === c).map((p) => {
              const r = results[p.key];
              return (
                <tr key={p.key} className="align-top">
                  <td className="px-2 py-2"><span className="font-medium">{p.label}</span><p className="text-xs text-muted">{p.notes}</p></td>
                  <td className="px-2 py-2"><StatusPill status={r?.status ?? p.status} /><p className="mt-1 text-xs text-muted">{p.environment}</p></td>
                  <td className="px-2 py-2 text-muted">
                    {r ? `${r.outcome.toLowerCase()} · ${r.latencyMs ?? "–"} ms · ${r.detail}` : p.lastCheck ? `${p.lastCheck.outcome.toLowerCase()} · ${fmt(p.lastCheck.checkedAt)}${p.lastCheck.latencyMs != null ? ` · ${p.lastCheck.latencyMs} ms` : ""}` : "Never tested"}
                    {p.lastSuccessAt && <p className="text-xs">Last success {fmt(p.lastSuccessAt)}</p>}
                  </td>
                  <td className="px-2 py-2 text-muted">{p.enabledFeatures.length ? p.enabledFeatures.join(", ") : "—"}</td>
                  <td className="space-x-2 whitespace-nowrap px-2 py-2 text-right">
                    {p.testable && data.canManage && <Button size="sm" variant="outline" disabled={testing === p.key} onClick={() => runTest(p)}>{testing === p.key ? "Testing…" : "Test connection"}</Button>}
                    {data.canManage && p.key.startsWith("comm:") && <Button size="sm" variant="outline" onClick={() => setToggle({ p, active: p.status === "DISABLED" })}>{p.status === "DISABLED" ? "Enable" : "Disable"}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setHistory(history === p.key ? null : p.key)}>History</Button>
                    {p.manageHref && <Link href={p.manageHref} className="text-sm text-primary hover:underline">Manage</Link>}
                  </td>
                </tr>
              );
            })}
          </Table>
          {history && data.items.find((p) => p.key === history)?.categoryLabel === c && (
            <div className="mt-3 rounded-lg border border-border p-3">
              <p className="mb-2 text-sm font-medium">Recent checks</p>
              {hist.loading ? <Loading /> : hist.error ? <ErrorNote message={hist.error} /> : (hist.data?.history.length ?? 0) === 0 ? <p className="text-sm text-muted">No checks recorded yet.</p> : (
                <Table head={["When", "Outcome", "Status", "Latency", "Note"]}>{hist.data?.history.map((h) => <tr key={h.id}><td className="px-2 py-1.5">{fmt(h.checkedAt)}</td><td className="px-2 py-1.5">{h.outcome.toLowerCase()}</td><td className="px-2 py-1.5"><StatusPill status={h.health} /></td><td className="px-2 py-1.5 text-muted">{h.latencyMs ?? "–"} ms</td><td className="px-2 py-1.5 text-muted">{h.detail ?? ""}</td></tr>)}</Table>
              )}
            </div>
          )}
          <Source>provider settings and recorded checks; health probes run on demand, not continuously</Source>
        </Card>
      ))}
      {data && <p className="text-xs text-muted"><Badge variant="muted">status words</Badge> {data.statuses.map((s) => s.replace(/_/g, " ").toLowerCase()).join(" · ")}</p>}
      <ChangeDialog
        open={toggle !== null}
        title={toggle ? `${toggle.active ? "Enable" : "Disable"} ${toggle.p.label}` : "Provider"}
        description="This changes whether the provider is used for sending. The provider's own screen has the rest of its settings."
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setToggle(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          if (!toggle) return null;
          const res = await sendChange(`/api/admin/platform/providers/${encodeURIComponent(toggle.p.key)}`, "PATCH", { active: toggle.active, reason, environment, stepUpToken });
          if (res.error) return res.error;
          if (res.approvalCode) setApproval(res.approvalCode);
          else show("Provider updated.", "success");
          setToggle(null);
          reload();
          return null;
        }}
      />
    </div>
  );
}
