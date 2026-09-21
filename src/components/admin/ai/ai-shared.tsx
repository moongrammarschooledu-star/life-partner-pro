"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Bot, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/admin/system/shared";

// ---------------------------------------------------------------------------
// Types mirroring the API response (src/lib/ai/route.ts)
// ---------------------------------------------------------------------------

export interface AiEvidence { label: string; value: string; source: "VERIFIED" | "USER_PROVIDED" | "AI_OBSERVATION" | "DATABASE" }
export interface AiFinding { label: string; area: string; message: string }
export interface AiResult {
  summary: string;
  evidence: AiEvidence[];
  alignedAreas: string[];
  potentialConflicts: string[];
  missingInformation: string[];
  verificationQuestions: string[];
  suggestedNextStep: string | null;
  limitations: string[];
  sufficiency: "SUFFICIENT" | "PARTIAL" | "LIMITED";
  findings?: AiFinding[];
  data?: Record<string, unknown>;
}
export interface AiLabels { generatedAt: string; aiVersion: string; promptVersion: string; provider: string; model: string; matchAlgorithmVersion: string }
export interface AiResponse { ok: true; result: AiResult; labels: AiLabels; requestId: string; fromCache: boolean; notices: string[]; disclaimer: string }

const SOURCE_STYLE: Record<AiEvidence["source"], { label: string; cls: string }> = {
  VERIFIED: { label: "Verified", cls: "bg-success/10 text-success" },
  USER_PROVIDED: { label: "User-provided", cls: "bg-surface-muted text-muted" },
  AI_OBSERVATION: { label: "AI observation", cls: "bg-warning/10 text-warning" },
  DATABASE: { label: "Database", cls: "bg-primary/10 text-primary" },
};

const SUFFICIENCY_LABEL = { SUFFICIENT: "Sufficient information", PARTIAL: "Partial information", LIMITED: "Limited information" };

export function useAiCall() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AiResponse | null>(null);

  async function run(url: string, body: unknown) {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) setError(data.error ?? "The request could not be completed.");
      else setResponse(data as AiResponse);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }
  return { loading, error, response, run, reset: () => { setResponse(null); setError(null); } };
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: "warn" }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className={`mb-1 text-sm font-semibold ${tone === "warn" ? "text-warning" : ""}`}>{title}</h4>
      <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </div>
  );
}

function ComparisonTable({ data }: { data: Record<string, unknown> }) {
  const columns = data.columns as Array<{ field: string; values: Record<string, string> }> | undefined;
  if (!columns?.length) return null;
  const refs = Object.keys(columns[0].values);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="border-b border-border text-left"><th className="py-2 pr-3">Area</th>{refs.map((r) => <th key={r} className="py-2 pr-3">{r}</th>)}</tr></thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.field} className="border-b border-border last:border-0 align-top">
              <td className="py-2 pr-3 font-medium">{c.field}</td>
              {refs.map((r) => <td key={r} className="py-2 pr-3 text-muted">{c.values[r]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">No ranking or winner is produced. System matching results (deterministic) are listed separately below when available.</p>
    </div>
  );
}

function DraftBox({ draft }: { draft: { subject?: string; body: string; language?: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Draft — not sent</span>
        <Button size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(`${draft.subject ? draft.subject + "\n\n" : ""}${draft.body}`); setCopied(true); } catch { /* clipboard unavailable */ } }}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      {draft.subject && <div className="text-sm font-medium">{draft.subject}</div>}
      <pre className="mt-1 whitespace-pre-wrap font-sans text-sm" dir={draft.language === "ur" ? "rtl" : "ltr"}>{draft.body}</pre>
      <p className="mt-2 text-xs text-muted">Replace every [placeholder], confirm consent, and send only through the normal communication flow with your explicit confirmation.</p>
    </div>
  );
}

// Spec §47/§70 — every result is labelled as AI-generated, with its source and versions, and uses the same layout.
export function ResultView({ response }: { response: AiResponse }) {
  const r = response.result;
  const data = r.data ?? {};
  const draft = (data.draft as { subject?: string; body: string; language?: string } | null | undefined) ?? null;
  const drafts = (data.drafts as Array<{ subject?: string; body: string; language?: string }> | undefined) ?? [];
  const sys = data.systemMatchingResults as Array<{ pair: string; label: string; total: number; tier: string; algorithmVersion: string }> | undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Bot className="h-4 w-4" />
        <span className="font-medium text-foreground">Generated by AI</span>
        <span>· Source: Life Partner Pro database</span>
        <span>· {new Date(response.labels.generatedAt).toLocaleString()}</span>
        <span>· {response.labels.provider === "RULES" ? "built-in analysis" : response.labels.provider} ({response.labels.model})</span>
        <span>· {response.labels.aiVersion} / {response.labels.matchAlgorithmVersion}</span>
        {response.fromCache && <span>· cached</span>}
      </div>

      {response.notices.map((n) => (
        <div key={n} className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><span>{n}</span></div>
      ))}

      <Card title="Summary" action={<span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{SUFFICIENCY_LABEL[r.sufficiency]}</span>}>
        <p className="text-sm">{r.summary}</p>
      </Card>

      {data.columns ? <Card title="Comparison"><ComparisonTable data={data} /></Card> : null}
      {sys && sys.length > 0 && (
        <Card title="System matching results (deterministic engine — not AI)">
          <ul className="space-y-1 text-sm">{sys.map((s) => <li key={s.pair}>{s.pair}: <span className="font-medium">{s.total}/100</span> · {s.tier} · <span className="text-muted">{s.algorithmVersion}</span></li>)}</ul>
        </Card>
      )}

      {r.evidence.length > 0 && (
        <Card title="Evidence">
          <ul className="divide-y divide-border">
            {r.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap items-start justify-between gap-2 py-1.5 text-sm">
                <span><span className="font-medium">{e.label}:</span> {e.value}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${SOURCE_STYLE[e.source].cls}`}>{SOURCE_STYLE[e.source].label}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <List title="What aligns" items={r.alignedAreas} />
        <List title="Potential conflicts — admin review required" items={r.potentialConflicts} tone="warn" />
        <List title="Missing information" items={r.missingInformation} />
        <List title="Questions / to verify" items={r.verificationQuestions} />
      </div>

      {r.findings && r.findings.length > 0 && (
        <Card title="Findings (observations for review — not conclusions)">
          <ul className="space-y-1 text-sm">
            {r.findings.map((f, i) => <li key={i}><span className="mr-2 rounded bg-surface-muted px-1.5 py-0.5 text-[11px]">{f.label.replace(/_/g, " ").toLowerCase()}</span><span className="font-medium">{f.area}:</span> {f.message}</li>)}
          </ul>
        </Card>
      )}

      {draft && <DraftBox draft={draft} />}
      {drafts.map((d, i) => <DraftBox key={i} draft={d} />)}

      {r.suggestedNextStep && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm"><span className="font-semibold">Suggested next step (for an admin to decide): </span>{r.suggestedNextStep}</div>
      )}

      <details className="rounded-xl border border-border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Limitations</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{r.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
      <p className="text-xs text-muted">{response.disclaimer}</p>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /><span>{message}</span></div>;
}

export function PanelIntro({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
