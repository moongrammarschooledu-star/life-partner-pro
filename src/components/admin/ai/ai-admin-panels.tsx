"use client";

import { useState } from "react";
import { Activity, Bot, Gauge, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { StatCard } from "@/components/admin/stat-card";
import { useToast } from "@/components/ui/toast";
import { Card, KV, Loading, ErrorNote, StatusBadge, SensitiveActionDialog, useApi, callApi, timeAgo } from "@/components/admin/system/shared";
import { PanelIntro } from "@/components/admin/ai/ai-shared";

const BASE = "/api/admin/ai";

// ---------------------------------------------------------------------------- Overview
interface Overview {
  phase: string; provider: string; model: string; killSwitchActive: boolean; externalKeyPresent: boolean;
  versions: { ai: string; matchAlgorithm: string; testSuite: string };
  health: { status: string };
  today: { requests: number; success: number; failed: number; blocked: number; denied: number };
  latestTest: { status: string; passed: number; failed: number; createdAt: string } | null;
  testsCurrentlyValid: boolean; honestyNote: string;
}

export function OverviewPanel() {
  const { data, error, loading } = useApi<Overview>(`${BASE}/overview`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <PanelIntro>{data.honestyNote}</PanelIntro>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Bot} label="Rollout phase" value={data.killSwitchActive ? "KILL SWITCH ON" : data.phase} accent={data.killSwitchActive ? "danger" : data.phase === "DISABLED" ? "muted" : "success"} />
        <StatCard icon={Activity} label="AI health" value={data.health.status} accent={data.health.status === "OK" ? "success" : data.health.status === "DISABLED" ? "muted" : "warning"} />
        <StatCard icon={Gauge} label="Requests today" value={data.today.requests} />
        <StatCard icon={ShieldAlert} label="Blocked / denied today" value={`${data.today.blocked} / ${data.today.denied}`} accent={data.today.blocked + data.today.denied > 0 ? "warning" : "success"} />
      </div>
      <Card title="Configuration at a glance">
        <dl>
          <KV label="Provider">{data.provider === "RULES" ? "Built-in analysis (no data leaves the system)" : data.provider}</KV>
          <KV label="Model">{data.model}</KV>
          <KV label="External provider key">{data.externalKeyPresent ? "present in environment (not shown)" : "not set"}</KV>
          <KV label="Versions">{data.versions.ai} · {data.versions.matchAlgorithm}</KV>
          <KV label="Latest test run">{data.latestTest ? <span>{timeAgo(data.latestTest.createdAt)} <StatusBadge status={data.latestTest.status} /> ({data.latestTest.passed} passed, {data.latestTest.failed} failed){data.testsCurrentlyValid ? " — currently valid" : " — not currently valid (old or prompts changed)"}</span> : "never run"}</KV>
        </dl>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- Health
interface Health {
  status: string; phase: string; killSwitchActive: boolean; provider: string; model: string; externalKeyPresent: boolean; externalActive: boolean;
  lastHour: { requests: number; failures: number };
  last24h: { requests: number; blocked: number; denied: number; safetyEvents: number; avgLatencyMs: number | null };
  lastSuccessAt: string | null; lastFailure: { at: string; code: string | null } | null; enabledFeatures: string[]; note: string;
}

export function HealthPanel() {
  const { data, error, loading, reload } = useApi<Health>(`${BASE}/health`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><PanelIntro>{data.note}</PanelIntro><Button size="sm" variant="outline" disabled={loading} onClick={reload}>{loading ? "Refreshing…" : "Refresh"}</Button></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Activity} label="Status" value={data.status} accent={data.status === "OK" ? "success" : data.status === "DISABLED" ? "muted" : "danger"} />
        <StatCard icon={Gauge} label="Requests (1 h)" value={data.lastHour.requests} />
        <StatCard icon={ShieldAlert} label="Failures (1 h)" value={data.lastHour.failures} accent={data.lastHour.failures > 0 ? "warning" : "success"} />
        <StatCard icon={Gauge} label="Avg latency (24 h)" value={data.last24h.avgLatencyMs != null ? `${data.last24h.avgLatencyMs} ms` : "—"} />
      </div>
      <Card title="Provider">
        <dl>
          <KV label="Configured provider">{data.provider} · {data.model}</KV>
          <KV label="External AI active">{data.externalActive ? "yes (allowed + key present + explicit member consent per request)" : "no — built-in analysis only"}</KV>
          <KV label="Last success">{timeAgo(data.lastSuccessAt)}</KV>
          <KV label="Last failure">{data.lastFailure ? `${timeAgo(data.lastFailure.at)} (${data.lastFailure.code ?? "error"})` : "none recorded"}</KV>
          <KV label="Safety-filter events (24 h)">{data.last24h.safetyEvents} · blocked outputs {data.last24h.blocked} · denied requests {data.last24h.denied}</KV>
          <KV label="Enabled features">{data.enabledFeatures.length ? data.enabledFeatures.join(", ") : "none"}</KV>
        </dl>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- Usage & cost
interface Usage {
  days: number; totals: { requests: number; success: number; failed: number; blocked: number; denied: number };
  tokens: number | null; estimatedCostUsd: number | null; costNote: string;
  byFeature: Array<{ key: string; requests: number; success: number; failed: number; blocked: number }>;
  byProvider: Array<{ key: string; requests: number }>;
  byAdmin: Array<{ key: string; name: string; requests: number }>;
}

export function UsagePanel() {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useApi<Usage>(`${BASE}/usage?days=${days}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelIntro>Requests and tokens are counted from real AI requests. Cost is an estimate, shown only when the provider reports token usage and a price is configured.</PanelIntro>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-32">{[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</Select>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Gauge} label="Requests" value={data.totals.requests} />
            <StatCard icon={Activity} label="Successful" value={data.totals.success} accent="success" />
            <StatCard icon={ShieldAlert} label="Failed / blocked / denied" value={`${data.totals.failed} / ${data.totals.blocked} / ${data.totals.denied}`} accent={data.totals.failed + data.totals.blocked > 0 ? "warning" : "success"} />
            <StatCard icon={Gauge} label="Estimated cost" value={data.estimatedCostUsd != null ? `$${data.estimatedCostUsd.toFixed(4)}` : "n/a"} />
          </div>
          <p className="text-xs text-muted">{data.costNote}{data.tokens != null ? ` Tokens reported: ${data.tokens}.` : ""}</p>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="By feature"><ul className="space-y-1 text-sm">{data.byFeature.map((f) => <li key={f.key} className="flex justify-between"><span>{f.key.replace(/_/g, " ").toLowerCase()}</span><span>{f.requests}</span></li>)}{data.byFeature.length === 0 && <li className="text-muted">No requests.</li>}</ul></Card>
            <Card title="By provider"><ul className="space-y-1 text-sm">{data.byProvider.map((f) => <li key={f.key} className="flex justify-between"><span>{f.key}</span><span>{f.requests}</span></li>)}{data.byProvider.length === 0 && <li className="text-muted">No requests.</li>}</ul></Card>
            <Card title="By admin"><ul className="space-y-1 text-sm">{data.byAdmin.map((f) => <li key={f.key} className="flex justify-between"><span>{f.name}</span><span>{f.requests}</span></li>)}{data.byAdmin.length === 0 && <li className="text-muted">No requests.</li>}</ul></Card>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- Activity / history
interface Activity {
  items: Array<{ id: string; actorName: string; actorRole: string; feature: string; status: string; provider: string; model: string; promptVersion: string; latencyMs: number | null; errorCode: string | null; fromCache: boolean; consentOutcome: string | null; createdAt: string }>;
  safetyEvents: Array<{ id: string; rule: string; action: string; feature: string | null; createdAt: string }>;
}

export function ActivityPanel() {
  const [status, setStatus] = useState("");
  const [days, setDays] = useState(7);
  const qs = `days=${days}${status ? `&status=${status}` : ""}`;
  const { data, error, loading } = useApi<Activity>(`${BASE}/activity?${qs}`);
  return (
    <div className="space-y-4">
      <PanelIntro>Metadata only: who used which feature, with which provider/model/prompt version, and the outcome. Prompt and result text are never stored in this log.</PanelIntro>
      <div className="flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-52"><option value="">All statuses</option>{["SUCCESS", "FALLBACK", "FAILED", "BLOCKED_SAFETY", "DENIED", "CONSENT_REQUIRED", "RATE_LIMITED", "QUOTA_EXCEEDED", "DISABLED"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40">{[1, 7, 30, 90].map((d) => <option key={d} value={d}>Last {d} day(s)</option>)}</Select>
      </div>
      {loading && !data ? <Loading /> : error ? <ErrorNote message={error} /> : data && (
        <>
          <Card title={`Requests (${data.items.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-b border-border text-left"><th className="py-2 pr-3">When</th><th className="pr-3">Admin</th><th className="pr-3">Feature</th><th className="pr-3">Status</th><th className="pr-3">Provider</th><th className="pr-3">Prompt</th><th className="pr-3">ms</th></tr></thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3">{timeAgo(r.createdAt)}</td><td className="pr-3">{r.actorName} <span className="text-xs text-muted">{r.actorRole}</span></td>
                      <td className="pr-3">{r.feature.replace(/_/g, " ").toLowerCase()}</td><td className="pr-3"><StatusBadge status={r.status} />{r.fromCache ? " · cached" : ""}</td>
                      <td className="pr-3">{r.provider}</td><td className="pr-3 font-mono text-xs">{r.promptVersion}</td><td className="pr-3">{r.latencyMs ?? "—"}</td>
                    </tr>
                  ))}
                  {data.items.length === 0 && <tr><td colSpan={7} className="py-3 text-muted">No requests in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Safety-filter events (rule names only)">
            <ul className="space-y-1 text-sm">{data.safetyEvents.map((s) => <li key={s.id}>{timeAgo(s.createdAt)} · <span className="font-mono text-xs">{s.rule}</span> · {s.action.toLowerCase()}{s.feature ? ` · ${s.feature.replace(/_/g, " ").toLowerCase()}` : ""}</li>)}{data.safetyEvents.length === 0 && <li className="text-muted">None in this period.</li>}</ul>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- Safety
export function SafetyPanel() {
  return (
    <div className="space-y-4">
      <PanelIntro>What the assistant will and will not do, and the known limits of these safeguards.</PanelIntro>
      <Card title="Hard boundaries">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>AI recommends and explains; humans decide. It cannot approve or reject a profile, reveal or share contact details, finalise a proposal, suspend, delete, refund or send a message.</li>
          <li>The compatibility score and ranking come only from the deterministic matching engine. AI text cannot change them and never ranks candidates.</li>
          <li>No facial or appearance assessment, no inference of ethnicity, health, personality or legal status, no guarantee or probability of marriage, and no accusation of fraud.</li>
          <li>Missing information is shown as &ldquo;insufficient information&rdquo;, never as incompatibility.</li>
          <li>Data the requesting admin cannot see is never loaded. Member consent is checked before processing; an external provider is used only with explicit member AI consent.</li>
        </ul>
      </Card>
      <Card title="Known limitations (spec §37)">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>The safety filter is rule- and pattern-based. It catches the failure classes it names; it is not proof of safety and can miss novel wording.</li>
          <li>Fairness review is a set of rule/probe checks on synthetic profiles, not a statistical bias audit. Stereotyping, socio-economic and religious over-reach are checked by pattern only.</li>
          <li>The built-in provider organises the platform&apos;s own data; it does not understand free text like a language model. The external adapter has not been exercised against a live provider unless a key has been configured and tested.</li>
          <li>Document analysis (spec §50) is not implemented and cannot be enabled.</li>
          <li>Prompt-injection defences reduce risk for external models; they cannot make a model immune, so output filtering and human review remain mandatory.</li>
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------- Settings
interface Config {
  config: {
    phase: string; killSwitchActive: boolean; killSwitchReason: string | null; provider: string; externalProviderAllowed: boolean; model: string; temperature: number;
    maxOutputTokens: number; timeoutMs: number; retryCount: number; dailyRequestCap: number; monthlyRequestCap: number; retentionDays: number; cacheTtlMinutes: number;
    storageModes: Record<string, string>; pilotAdminIds: string[]; priceInputPerMTokUsd: number | null; priceOutputPerMTokUsd: number | null;
  };
  externalKeyPresent: boolean; features: string[]; versions: { ai: string; matchAlgorithm: string; testSuite: string };
}
interface TestRun { id: string; suite: string; status: string; passed: number; failed: number; createdAt: string; failures: Array<{ name: string; detail: string }> | null }
interface Prompt { feature: string; id: string; checksum: string; approved: boolean }

const PHASES = ["DISABLED", "INTERNAL_TEST", "STAFF_PILOT", "LIMITED_PRODUCTION", "PRODUCTION"];

export function SettingsPanel({ canConfig, canRollout, canKill, canTest }: { canConfig: boolean; canRollout: boolean; canKill: boolean; canTest: boolean }) {
  const { show } = useToast();
  const cfg = useApi<Config>(canConfig ? `${BASE}/config` : null);
  const tests = useApi<{ items: TestRun[] }>(canTest ? `${BASE}/tests` : null);
  const prompts = useApi<{ items: Prompt[] }>(canConfig ? `${BASE}/prompts` : null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "rollout" | "kill-on" | "kill-off" | "prompts" | "config">(null);
  const [phase, setPhase] = useState("INTERNAL_TEST");
  const [draft, setDraft] = useState<{ dailyRequestCap?: number; monthlyRequestCap?: number; retentionDays?: number; provider?: string; externalProviderAllowed?: boolean; model?: string }>({});

  async function runTests() {
    setBusy(true);
    try {
      const res = await callApi<{ status: string; passed: number; failed: number }>(`${BASE}/tests`, "POST", { suite: "all" });
      show(res.ok ? `AI tests ${res.data.status}: ${res.data.passed} passed, ${res.data.failed} failed` : res.data.error ?? "Could not run tests", res.ok && res.data.status === "PASS" ? "success" : "error");
      tests.reload();
    } finally { setBusy(false); }
  }

  if (canConfig && cfg.loading && !cfg.data) return <Loading />;
  const c = cfg.data?.config;

  return (
    <div className="space-y-4">
      <PanelIntro>Changing the provider, model, storage policy or rollout phase needs a fresh passing test run. Provider secrets are never stored or shown — the external key lives only in the server environment.</PanelIntro>

      {canKill && c && (
        <Card title="Kill switch" action={<StatusBadge status={c.killSwitchActive ? "BLOCKED" : "PASS"} />}>
          <p className="mb-3 text-sm text-muted">{c.killSwitchActive ? `AI assistance is OFF${c.killSwitchReason ? ` — ${c.killSwitchReason}` : ""}. Deterministic matching and every other feature continue normally.` : "Stops every AI request instantly. Matching, proposals, payments and all other workflows are unaffected."}</p>
          {c.killSwitchActive
            ? <Button size="sm" onClick={() => setDialog("kill-off")}>Re-enable AI assistance</Button>
            : <Button size="sm" variant="danger" onClick={() => setDialog("kill-on")}>Disable AI assistance</Button>}
        </Card>
      )}

      {canRollout && c && (
        <Card title={`Rollout phase: ${c.phase}`}>
          <p className="mb-3 text-sm text-muted">DISABLED → INTERNAL_TEST (Super Admin) → STAFF_PILOT → LIMITED_PRODUCTION → PRODUCTION. One step at a time; any phase can return to DISABLED. Moving beyond internal testing needs a passing test run.</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Move to" htmlFor="ai-phase"><Select id="ai-phase" value={phase} onChange={(e) => setPhase(e.target.value)}>{PHASES.filter((p) => p !== c.phase).map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
            <Button size="sm" onClick={() => setDialog("rollout")}>Change phase</Button>
          </div>
        </Card>
      )}

      {canTest && (
        <Card title="Tests (safety · privacy · security · reliability · analysis)" action={<Button size="sm" disabled={busy} onClick={runTests}>{busy ? "Running…" : "Run tests"}</Button>}>
          {tests.data?.items[0] ? (
            <div className="space-y-2 text-sm">
              <div>Latest: <StatusBadge status={tests.data.items[0].status} /> {tests.data.items[0].passed} passed, {tests.data.items[0].failed} failed · {timeAgo(tests.data.items[0].createdAt)}</div>
              {(tests.data.items[0].failures ?? []).map((f) => <div key={f.name} className="text-danger">✗ {f.name} — {f.detail}</div>)}
              <p className="text-xs text-muted">Synthetic profiles only; no production data is used. The full Vitest suite runs in CI.</p>
            </div>
          ) : <p className="text-sm text-muted">No test run yet.</p>}
        </Card>
      )}

      {canConfig && c && (
        <Card title="Provider, limits and retention">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Provider" htmlFor="ai-prov"><Select id="ai-prov" value={draft.provider ?? c.provider} onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))}><option value="RULES">Built-in analysis</option><option value="ANTHROPIC">Claude (external)</option><option value="DISABLED">Disabled</option></Select></Field>
            <Field label="Model" htmlFor="ai-model"><Input id="ai-model" value={draft.model ?? c.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} /></Field>
            <Field label="External access allowed" htmlFor="ai-ext" hint={cfg.data?.externalKeyPresent ? "Key present in environment." : "No key in environment — external AI cannot run."}><Select id="ai-ext" value={String(draft.externalProviderAllowed ?? c.externalProviderAllowed)} onChange={(e) => setDraft((d) => ({ ...d, externalProviderAllowed: e.target.value === "true" }))}><option value="false">No</option><option value="true">Yes (needs explicit member consent per request)</option></Select></Field>
            <Field label="Daily request cap" htmlFor="ai-dc"><Input id="ai-dc" type="number" min={0} value={draft.dailyRequestCap ?? c.dailyRequestCap} onChange={(e) => setDraft((d) => ({ ...d, dailyRequestCap: Number(e.target.value) }))} /></Field>
            <Field label="Monthly request cap" htmlFor="ai-mc"><Input id="ai-mc" type="number" min={0} value={draft.monthlyRequestCap ?? c.monthlyRequestCap} onChange={(e) => setDraft((d) => ({ ...d, monthlyRequestCap: Number(e.target.value) }))} /></Field>
            <Field label="Result retention (days)" htmlFor="ai-rd"><Input id="ai-rd" type="number" min={1} max={365} value={draft.retentionDays ?? c.retentionDays} onChange={(e) => setDraft((d) => ({ ...d, retentionDays: Number(e.target.value) }))} /></Field>
          </div>
          <p className="mt-2 text-xs text-muted">Default storage keeps only a summary (no evidence lines, no lists); stored results expire after the retention period and are removed when a member&apos;s data is deleted. Storage policy per feature is changed through the API (needs a passing test run).</p>
          <div className="mt-3"><Button size="sm" disabled={Object.keys(draft).length === 0} onClick={() => setDialog("config")}>Save changes</Button></div>
        </Card>
      )}

      {canConfig && prompts.data && (
        <Card title="Prompt versions" action={<Button size="sm" variant="outline" onClick={() => setDialog("prompts")}>Approve current prompts</Button>}>
          <ul className="space-y-1 text-sm">{prompts.data.items.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><span className="font-mono text-xs">{p.id}</span><span className="flex items-center gap-2 text-xs text-muted">{p.checksum}<StatusBadge status={p.approved ? "PASS" : "unknown"} /></span></li>)}</ul>
          <p className="mt-2 text-xs text-muted">Approval records each template&apos;s checksum against the passing test run that allowed it. Editing a template invalidates its approval.</p>
        </Card>
      )}

      <SensitiveActionDialog
        open={dialog === "kill-on"} danger title="Disable AI assistance" confirmLabel="Disable AI"
        description="All AI requests stop immediately. Matching and every other feature keep working. A written reason is required."
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason }) => { const r = await callApi(`${BASE}/killswitch`, "POST", { active: true, reason }); if (!r.ok) return r.data.error ?? "Could not disable AI"; show("AI assistance disabled", "success"); cfg.reload(); return null; }}
      />
      <SensitiveActionDialog
        open={dialog === "kill-off"} title="Re-enable AI assistance" confirmLabel="Re-enable"
        description="AI resumes at the current rollout phase. Password re-confirmation and a reason are required."
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason, stepUpToken }) => { const r = await callApi(`${BASE}/killswitch`, "POST", { active: false, reason, stepUpToken }); if (!r.ok) return r.data.error ?? "Could not re-enable AI"; show("AI assistance re-enabled", "success"); cfg.reload(); return null; }}
      />
      <SensitiveActionDialog
        open={dialog === "rollout"} title={`Change rollout phase to ${phase}`}
        description="Phases advance one step at a time; DISABLED is always available. Password re-confirmation and a reason are required."
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason, stepUpToken }) => { const r = await callApi(`${BASE}/rollout`, "POST", { phase, reason, stepUpToken }); if (!r.ok) return r.data.error ?? "Could not change the phase"; show("Rollout phase updated", "success"); cfg.reload(); return null; }}
      />
      <SensitiveActionDialog
        open={dialog === "config"} title="Save AI settings"
        description="Recorded in the configuration history and audit log. Provider/model/external-access changes need a passing test run."
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason, stepUpToken }) => { const r = await callApi(`${BASE}/config`, "PATCH", { values: draft, reason, stepUpToken }); if (!r.ok) return r.data.error ?? "Could not save"; setDraft({}); show("AI settings saved", "success"); cfg.reload(); return null; }}
      />
      <SensitiveActionDialog
        open={dialog === "prompts"} title="Approve current prompt versions"
        description="Requires a fresh passing test run made against these exact prompts."
        onCancel={() => setDialog(null)}
        onConfirm={async ({ reason, stepUpToken }) => { const r = await callApi(`${BASE}/prompts`, "POST", { reason, stepUpToken }); if (!r.ok) return r.data.error ?? "Could not approve"; show("Prompts approved", "success"); prompts.reload(); return null; }}
      />
    </div>
  );
}
