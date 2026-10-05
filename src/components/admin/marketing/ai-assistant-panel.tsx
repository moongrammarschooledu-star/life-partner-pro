"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Card } from "@/components/admin/system/shared";
import { useToast } from "@/components/ui/toast";

// STEP 29 §32 — drafts only. The assistant offers wording from a fixed, approved phrase library; it has no launch, spend,
// approval, audience or send capability, and every result is labelled for human review. Copy still goes through the
// normal campaign/page review before it can be used.

const MODES = [
  ["HEADLINES", "Headline ideas"], ["DESCRIPTIONS", "Description ideas"], ["CTAS", "Call-to-action ideas"], ["FAQ", "FAQ drafts"],
  ["LANDING_INTRO", "Landing page introduction"], ["LEAD_FOLLOWUP", "Lead follow-up message draft (not sent)"],
] as const;

interface AiResult { ok: boolean; result?: { summary: string; data?: { suggestions?: string[]; reviewLabel?: string }; limitations: string[] }; message?: string }

export function AiAssistantPanel() {
  const { show } = useToast();
  const [mode, setMode] = useState<(typeof MODES)[number][0]>("HEADLINES");
  const [language, setLanguage] = useState<"EN" | "UR">("EN");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<AiResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/marketing/ai/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, language }) });
      const data = (await res.json().catch(() => ({}))) as AiResult;
      if (!res.ok || !data.ok) show(data.message ?? "The assistant is not available.", "error");
      setOut(res.ok ? data : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Copy assistant (drafts only)">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="What do you need?"><Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="w-72">{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value as "EN" | "UR")} className="w-28"><option value="EN">English</option><option value="UR">Urdu</option></Select></Field>
        <Button onClick={run} disabled={busy}>{busy ? "Working…" : "Suggest"}</Button>
      </div>
      {out?.result && (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-medium">{out.result.data?.reviewLabel ?? "AI-Assisted Draft — Human Review Required"}</p>
          <p className="text-muted">{out.result.summary}</p>
          <ul className="space-y-2" dir={language === "UR" ? "rtl" : "ltr"}>
            {(out.result.data?.suggestions ?? []).map((s, i) => <li key={i} className="whitespace-pre-line rounded-lg border border-border bg-background p-3">{s}</li>)}
          </ul>
          <ul className="list-disc ps-5 text-xs text-muted">{out.result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}
