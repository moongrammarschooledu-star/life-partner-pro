"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card } from "@/components/admin/system/shared";
import { ErrorBox, PanelIntro, ResultView, useAiCall } from "@/components/admin/ai/ai-shared";

const BASE = "/api/admin/ai";
const CODE_HINT = "Profile code (e.g. LPP-000123)";

function Form({ onSubmit, busy, submit, children }: { onSubmit: () => void; busy: boolean; submit: string; children: ReactNode }) {
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-3"
    >
      {children}
      <Button type="submit" disabled={busy}>{busy ? "Working…" : submit}</Button>
    </form>
  );
}

function Output({ call }: { call: ReturnType<typeof useAiCall> }) {
  if (call.error) return <ErrorBox message={call.error} />;
  if (call.response) return <ResultView response={call.response} />;
  return null;
}

const clean = (s: string) => s.trim();

export function AnalyzeProfilePanel() {
  const call = useAiCall();
  const [ref, setRef] = useState("");
  return (
    <div className="space-y-4">
      <PanelIntro>Structured summary of a profile. Lines are labelled Verified, User-provided or AI observation; nothing here is a verified statement of fact.</PanelIntro>
      <Form busy={call.loading} submit="Generate profile summary" onSubmit={() => call.run(`${BASE}/profile-summary`, { profileId: clean(ref) })}>
        <Field label="Profile" htmlFor="ai-profile"><Input id="ai-profile" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={CODE_HINT} required /></Field>
      </Form>
      <Output call={call} />
    </div>
  );
}

export function DataQualityPanel({ mode }: { mode: "quality" | "improvement" }) {
  const call = useAiCall();
  const [ref, setRef] = useState("");
  return (
    <div className="space-y-4">
      <PanelIntro>
        {mode === "quality"
          ? "Finds missing, potentially inconsistent and unverified information. Findings are observations for admin review — they never reject, suspend or accuse anyone."
          : "Suggests neutral ways a profile could be completed or clarified. Suggestions are text only; nothing is ever written to the profile."}
      </PanelIntro>
      <Form busy={call.loading} submit={mode === "quality" ? "Find missing information" : "Suggest improvements"} onSubmit={() => call.run(`${BASE}/data-quality`, { profileId: clean(ref), mode })}>
        <Field label="Profile" htmlFor={`ai-dq-${mode}`}><Input id={`ai-dq-${mode}`} value={ref} onChange={(e) => setRef(e.target.value)} placeholder={CODE_HINT} required /></Field>
      </Form>
      <Output call={call} />
    </div>
  );
}

export function ExplainMatchPanel() {
  const call = useAiCall();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  return (
    <div className="space-y-4">
      <PanelIntro>Explains a match in neutral language and analyses both profiles&apos; requirements against each other. The compatibility score itself always comes from the deterministic matching engine — AI cannot change it.</PanelIntro>
      <Form busy={call.loading} submit="Explain match" onSubmit={() => call.run(`${BASE}/match-explanation`, { profileAId: clean(a), profileBId: clean(b) })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Profile A" htmlFor="ai-ma"><Input id="ai-ma" value={a} onChange={(e) => setA(e.target.value)} placeholder={CODE_HINT} required /></Field>
          <Field label="Profile B" htmlFor="ai-mb"><Input id="ai-mb" value={b} onChange={(e) => setB(e.target.value)} placeholder={CODE_HINT} required /></Field>
        </div>
      </Form>
      <Output call={call} />
    </div>
  );
}

export function ComparePanel() {
  const call = useAiCall();
  const [refs, setRefs] = useState(["", "", "", ""]);
  const filled = refs.map(clean).filter(Boolean);
  return (
    <div className="space-y-4">
      <PanelIntro>Side-by-side comparison of 2–4 candidates. No AI winner or ranking is produced; deterministic matching results are shown separately and clearly labelled.</PanelIntro>
      <Form busy={call.loading || filled.length < 2} submit="Compare candidates" onSubmit={() => call.run(`${BASE}/compare`, { profileIds: filled })}>
        <div className="grid gap-3 sm:grid-cols-2">
          {refs.map((r, i) => (
            <Field key={i} label={`Profile ${String.fromCharCode(65 + i)}${i < 2 ? "" : " (optional)"}`} htmlFor={`ai-c${i}`}>
              <Input id={`ai-c${i}`} value={r} onChange={(e) => setRefs((p) => p.map((x, j) => (j === i ? e.target.value : x)))} placeholder={CODE_HINT} />
            </Field>
          ))}
        </div>
      </Form>
      <Output call={call} />
    </div>
  );
}

export function ProposalPanel() {
  const call = useAiCall();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [proposalId, setProposalId] = useState("");
  return (
    <div className="space-y-4">
      <PanelIntro>Prepares a neutral internal note before you create or send a proposal. It is not a recommendation to proceed, and nothing is created or sent. You review and approve.</PanelIntro>
      <Form busy={call.loading} submit="Prepare proposal note" onSubmit={() => call.run(`${BASE}/proposal-assistance`, { profileAId: clean(a), profileBId: clean(b), ...(clean(proposalId) ? { proposalId: clean(proposalId) } : {}) })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Profile A" htmlFor="ai-pa"><Input id="ai-pa" value={a} onChange={(e) => setA(e.target.value)} placeholder={CODE_HINT} required /></Field>
          <Field label="Profile B" htmlFor="ai-pb"><Input id="ai-pb" value={b} onChange={(e) => setB(e.target.value)} placeholder={CODE_HINT} required /></Field>
        </div>
        <Field label="Existing proposal id (optional)" htmlFor="ai-pid"><Input id="ai-pid" value={proposalId} onChange={(e) => setProposalId(e.target.value)} /></Field>
      </Form>
      <Output call={call} />
    </div>
  );
}

interface FollowUpItem { id: string; purpose?: string | null; dueDate: string; priority?: string }

export function FollowUpPanel() {
  const call = useAiCall();
  const [items, setItems] = useState<FollowUpItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    fetch("/api/admin/follow-ups")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { today?: FollowUpItem[]; overdue?: FollowUpItem[] }) => setItems([...(d.overdue ?? []), ...(d.today ?? [])]))
      .catch(() => setError("Could not load follow-ups."));
  }, []);
  return (
    <div className="space-y-4">
      <PanelIntro>Suggests a next action and a draft for a due or overdue follow-up. It never sends anything and never marks a follow-up complete.</PanelIntro>
      {error && <ErrorBox message={error} />}
      <Form busy={call.loading || !id} submit="Suggest follow-up" onSubmit={() => call.run(`${BASE}/followup-draft`, { followUpId: id, language })}>
        <Field label="Follow-up" htmlFor="ai-fu">
          <Select id="ai-fu" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">{items === null ? "Loading…" : items.length ? "Select a due / overdue follow-up" : "No due or overdue follow-ups"}</option>
            {(items ?? []).map((f) => <option key={f.id} value={f.id}>{new Date(f.dueDate).toLocaleDateString()} · {f.priority ?? ""} · {(f.purpose ?? "No purpose recorded").slice(0, 60)}</option>)}
          </Select>
        </Field>
        <Field label="Language" htmlFor="ai-fu-lang">
          <Select id="ai-fu-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="en">English</option><option value="ur">Urdu (اردو)</option><option value="roman-ur">Roman Urdu</option>
          </Select>
        </Field>
      </Form>
      <Output call={call} />
    </div>
  );
}

const KINDS = [
  ["PROPOSAL_MESSAGE", "Respectful proposal message"],
  ["INFORMATION_REQUEST", "Request for information"],
  ["FOLLOW_UP", "Follow-up message"],
  ["MEETING_COORDINATION", "Meeting coordination"],
  ["REMINDER", "Reminder"],
  ["STATUS_UPDATE", "Neutral status update"],
] as const;

export function CommunicationPanel() {
  const call = useAiCall();
  const [ref, setRef] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("PROPOSAL_MESSAGE");
  const [language, setLanguage] = useState("en");
  return (
    <div className="space-y-4">
      <PanelIntro>Drafts a respectful, non-pressuring message. It contains no contact details or private information, and is never sent from here — you review it and send through the normal flow.</PanelIntro>
      <Form busy={call.loading} submit="Draft message" onSubmit={() => call.run(`${BASE}/communication-draft`, { profileId: clean(ref), kind, language })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Recipient profile" htmlFor="ai-cm-p"><Input id="ai-cm-p" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={CODE_HINT} required /></Field>
          <Field label="Message type" htmlFor="ai-cm-k"><Select id="ai-cm-k" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Language" htmlFor="ai-cm-l"><Select id="ai-cm-l" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en">English</option><option value="ur">Urdu (اردو)</option><option value="roman-ur">Roman Urdu</option></Select></Field>
        </div>
      </Form>
      <Output call={call} />
    </div>
  );
}

const EXAMPLES = ["Summarize this profile.", "What information is missing?", "Summarize today's pending proposals.", "Show me profiles requiring follow-up.", "Summarize unresolved support cases.", "Give me the monthly registration report"];

export function CopilotPanel() {
  const call = useAiCall();
  const [message, setMessage] = useState("");
  const [ref, setRef] = useState("");
  return (
    <div className="space-y-4">
      <PanelIntro>Ask questions in plain language. Every answer respects your own permissions and only reads or drafts — it cannot send, approve, share contact details, delete, suspend, refund or finalise anything.</PanelIntro>
      <Form busy={call.loading} submit="Ask" onSubmit={() => call.run(`${BASE}/copilot`, { message: clean(message), ...(clean(ref) ? { profileId: clean(ref) } : {}) })}>
        <Field label="Profile in context (optional — used for “this profile”)" htmlFor="ai-co-p"><Input id="ai-co-p" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={CODE_HINT} /></Field>
        <Field label="Your question" htmlFor="ai-co-m"><Textarea id="ai-co-m" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={500} required /></Field>
        <div className="flex flex-wrap gap-2">{EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setMessage(ex)} className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:text-foreground">{ex}</button>)}</div>
      </Form>
      <Output call={call} />
    </div>
  );
}

export function ReportPanel() {
  const call = useAiCall();
  const [report, setReport] = useState("registrations");
  const [days, setDays] = useState(30);
  return (
    <Card title="Report assistant">
      <div className="space-y-4">
        <PanelIntro>Restates figures from the existing reports. Every number comes from the database; nothing is estimated or invented.</PanelIntro>
        <Form busy={call.loading} submit="Summarise report" onSubmit={() => call.run(`${BASE}/report-summary`, { report, days })}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Report" htmlFor="ai-rp"><Select id="ai-rp" value={report} onChange={(e) => setReport(e.target.value)}>{["registrations", "proposals", "followups", "verification", "support"].map((r) => <option key={r} value={r}>{r}</option>)}</Select></Field>
            <Field label="Days" htmlFor="ai-rd"><Select id="ai-rd" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
          </div>
        </Form>
        <Output call={call} />
      </div>
    </Card>
  );
}

