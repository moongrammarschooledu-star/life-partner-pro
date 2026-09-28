"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Checkbox } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, SensitiveActionDialog, callApi, useApi } from "@/components/admin/system/shared";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

type Config = Record<string, number | boolean>;
interface RuleRow { key: string; name: string; category: string; description: string; defaults: Config; effective: Config; version: number; threshold: boolean }
interface FactorRow { key: string; name: string; category: string; weight: number; defaultWeight: number; severity: string; enabled: boolean; immediateControl: boolean; version: number }
interface RulesResponse { rules: RuleRow[]; factors: FactorRow[]; recentChanges: Array<{ ruleKey: string; version: number; status: string; jurisdictionScope: string; effectiveFrom: string }> }
interface ConfigResponse { thresholds: RuleRow[]; rateLimitPolicies: Array<{ policyKey: string; version: number; limit: number; windowSeconds: number }>; knownLimiters: Record<string, { limit: number; windowMs: number }> }

type Editing = { kind: "rule"; row: RuleRow } | { kind: "threshold"; row: RuleRow } | { kind: "factor"; row: FactorRow } | { kind: "limit"; policyKey: string; limit: number; windowSeconds: number } | null;

export function RiskRulesClient({ permissions }: { permissions: string[] }) {
  const can = (p: string) => permissions.includes(p);
  const rules = useApi<RulesResponse>(can("risk:rules:view") ? "/api/admin/risk/rules" : null);
  const config = useApi<ConfigResponse>(can("risk:configuration:view") ? "/api/admin/risk/configuration" : null);
  const { show } = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});

  function open(e: Editing) {
    setEditing(e);
    if (!e) return;
    if (e.kind === "rule" || e.kind === "threshold") setDraft(Object.fromEntries(Object.entries(e.row.effective).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v)])));
    if (e.kind === "factor") setDraft({ weight: String(e.row.weight), enabled: e.row.enabled });
    if (e.kind === "limit") setDraft({ limit: String(e.limit), windowSeconds: String(e.windowSeconds) });
  }

  async function submit(reason: string, stepUpToken: string): Promise<string | null> {
    if (!editing) return null;
    let url = "";
    let body: Record<string, unknown> = { reason, stepUpToken };
    if (editing.kind === "rule") {
      url = `/api/admin/risk/rules/${editing.row.key}`;
      body = { ...body, config: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === "boolean" ? v : Number(v)])) };
    } else if (editing.kind === "threshold") {
      url = "/api/admin/risk/configuration";
      body = { ...body, ruleKey: editing.row.key, config: Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === "boolean" ? v : Number(v)])) };
    } else if (editing.kind === "factor") {
      url = `/api/admin/risk/rules/factors/${editing.row.key}`;
      body = { ...body, weight: Number(draft.weight), enabled: draft.enabled === true };
    } else {
      url = "/api/admin/risk/configuration";
      body = { ...body, policyKey: editing.policyKey, limit: Number(draft.limit), windowSeconds: Number(draft.windowSeconds) };
    }
    const r = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(url, "PATCH", body);
    if (!r.ok && r.status !== 202) return r.data.error ?? "The change could not be saved.";
    if (r.data.approvalRequired) show(`Approval requested (${r.data.approvalCode}). Nothing changes until it is approved and re-submitted.`, "info");
    else show("New version saved", "success");
    setEditing(null);
    rules.reload();
    config.reload();
    return null;
  }

  const editingTitle = editing?.kind === "factor" ? editing.row.name : editing?.kind === "limit" ? `Rate limit: ${editing.policyKey}` : editing?.row.name ?? "";

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/risk-center" className="text-sm text-primary hover:underline">← Risk &amp; Safety Center</Link>
        <h1 className="text-xl font-semibold">Rules, factors &amp; thresholds</h1>
        <p className="text-sm text-muted">Every change creates a new version (nothing is edited in place), needs a reason and your password, and goes through approval. Sensitive personal traits can never be used as a rule or factor.</p>
      </div>
      {((can("risk:rules:view") && rules.loading && !rules.data) || (can("risk:configuration:view") && config.loading && !config.data)) && <Loading />}
      {rules.error && <ErrorNote message={rules.error} />}

      {config.data && (
        <Card title="Thresholds">
          <div className="space-y-3">
            {config.data.thresholds.map((t) => (
              <div key={t.key} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{t.name}</span>{can("risk:configuration:manage") && <Button size="sm" variant="outline" onClick={() => open({ kind: "threshold", row: t })}>Change…</Button>}</div>
                <p className="text-xs text-muted">{t.description}</p>
                <p className="mt-1 text-xs">Version {t.version || "default"} · {Object.entries(t.effective).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {config.data && (
        <Card title="Rate limits">
          <ul className="divide-y divide-border text-sm">
            {Object.entries(config.data.knownLimiters).map(([key, d]) => {
              const active = config.data?.rateLimitPolicies.find((p) => p.policyKey === key);
              const limit = active?.limit ?? d.limit;
              const windowSeconds = active?.windowSeconds ?? Math.round(d.windowMs / 1000);
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="font-mono text-xs">{key}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">{limit} / {windowSeconds}s {active ? <Badge variant="info">custom v{active.version}</Badge> : <Badge variant="muted">default</Badge>}
                    {can("risk:configuration:manage") && <Button size="sm" variant="ghost" onClick={() => open({ kind: "limit", policyKey: key, limit, windowSeconds })}>Change…</Button>}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {rules.data && (
        <>
          <Card title="Detection rules">
            <div className="space-y-3">
              {rules.data.rules.filter((r) => !r.threshold).map((r) => (
                <div key={r.key} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{r.name} <span className="ml-1 text-xs text-muted">{formatEnumLabel(r.category)}</span></span>{can("risk:rules:manage") && <Button size="sm" variant="outline" onClick={() => open({ kind: "rule", row: r })}>Change…</Button>}</div>
                  <p className="text-xs text-muted">{r.description}</p>
                  <p className="mt-1 text-xs">Version {r.version || "default"} · {Object.entries(r.effective).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Factors (contribution to the internal score)">
            <ul className="divide-y divide-border text-sm">
              {rules.data.factors.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{f.name} <span className="font-mono text-xs text-muted">{f.key}</span>{f.immediateControl && <Badge variant="warning" className="ml-2">immediate-control</Badge>}</span>
                  <span className="flex items-center gap-2 text-xs text-muted">weight {f.weight} (default {f.defaultWeight}) · {f.enabled ? "enabled" : "disabled"} · v{f.version || "default"}{can("risk:rules:manage") && <Button size="sm" variant="ghost" onClick={() => open({ kind: "factor", row: f })}>Change…</Button>}</span>
                </li>
              ))}
            </ul>
          </Card>
          {rules.data.recentChanges.length > 0 && (
            <Card title="Recent versions">
              <dl>{rules.data.recentChanges.map((c, i) => <KV key={i} label={`${c.ruleKey} v${c.version}`}>{formatEnumLabel(c.status)} · {formatDateTime(c.effectiveFrom)}</KV>)}</dl>
            </Card>
          )}
        </>
      )}

      <SensitiveActionDialog
        open={!!editing} title={`Change: ${editingTitle}`} confirmLabel="Submit change" onCancel={() => setEditing(null)}
        description="A new version is created; the previous one is kept. The change is reviewed by a second person before it takes effect."
        onConfirm={({ reason, stepUpToken }) => submit(reason, stepUpToken)}
      >
        <div className="space-y-2">
          {Object.entries(draft).map(([k, v]) =>
            typeof v === "boolean" ? (
              <Checkbox key={k} label={formatEnumLabel(k)} checked={v} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
            ) : (
              <Field key={k} label={formatEnumLabel(k)} htmlFor={`f-${k}`}><Input id={`f-${k}`} type="number" value={v} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></Field>
            )
          )}
        </div>
      </SensitiveActionDialog>
    </div>
  );
}
