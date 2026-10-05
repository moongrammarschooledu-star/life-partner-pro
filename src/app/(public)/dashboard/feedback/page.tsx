"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

interface Item { code: string; type: string; subject: string | null; status: string; createdAt: string }
interface Survey { id: string; title: string; questions: Array<{ id: string; text: string; type: "RATING" | "TEXT" }> }

const TYPES = [
  ["PLATFORM", "About the platform"], ["EXPERIENCE", "My experience"], ["SUPPORT", "About support"], ["FEATURE_REQUEST", "An idea or request"], ["BUG_REPORT", "Something is not working"],
] as const;

// STEP 30 - feedback is about the platform and support only. It is never about a person or a match, and it does not affect any proposal.
export default function FeedbackPage() {
  const { show } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [type, setType] = useState<string>("PLATFORM");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/my-feedback", { cache: "no-store" });
    if (!res.ok) return setEnabled(false);
    const json = (await res.json()) as { enabled: boolean; items: Item[] };
    setEnabled(json.enabled);
    setItems(json.items);
    const sv = await fetch("/api/my-feedback/surveys", { cache: "no-store" });
    if (sv.ok) setSurveys(((await sv.json()) as { items: Survey[] }).items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/my-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, subject: subject || undefined, message, rating: rating ? Number(rating) : undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return show((json as { error?: string }).error ?? "Could not send your feedback.", "error");
      show(`Thank you. Reference ${(json as { reference?: string }).reference ?? ""}`.trim(), "success");
      setSubject("");
      setMessage("");
      setRating("");
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function sendSurvey(id: string) {
    const res = await fetch(`/api/my-feedback/surveys/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: answers[id] ?? {} }) });
    const json = await res.json().catch(() => ({}));
    show(res.ok ? "Thank you for your answers." : (json as { error?: string }).error ?? "Could not save your answers.", res.ok ? "success" : "error");
  }

  if (enabled === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  if (!enabled) return <div><h1 className="font-heading text-2xl font-semibold">Feedback</h1><p className="mt-1 text-sm text-muted">Feedback is not available yet.</p></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Feedback</h1>
        <p className="mt-1 text-sm text-muted">Tell us how the platform and our support can be better. This is not about any person or proposal and does not change either.</p>
      </div>
      <Card>
        <CardContent className="space-y-3">
          <Field label="What is it about?"><Select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Subject (optional)"><Input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="Your message"><Textarea value={message} maxLength={2000} rows={5} onChange={(e) => setMessage(e.target.value)} /></Field>
          <Field label="How satisfied are you with the platform? (optional)">
            <Select value={rating} onChange={(e) => setRating(e.target.value)} className="w-40"><option value="">No rating</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</Select>
          </Field>
          <Button onClick={send} disabled={busy || message.trim().length < 5}>{busy ? "Sending…" : "Send feedback"}</Button>
        </CardContent>
      </Card>

      {surveys.map((s) => (
        <Card key={s.id}>
          <CardContent className="space-y-3">
            <h2 className="font-medium">{s.title}</h2>
            {s.questions.map((q) => (
              <Field key={q.id} label={q.text}>
                {q.type === "RATING" ? (
                  <Select value={answers[s.id]?.[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [s.id]: { ...answers[s.id], [q.id]: e.target.value } })} className="w-40"><option value="">Skip</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</Select>
                ) : (
                  <Textarea rows={2} maxLength={1000} value={answers[s.id]?.[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [s.id]: { ...answers[s.id], [q.id]: e.target.value } })} />
                )}
              </Field>
            ))}
            <Button size="sm" onClick={() => sendSurvey(s.id)}>Submit answers</Button>
          </CardContent>
        </Card>
      ))}

      {items.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="font-medium">Your earlier feedback</h2>
            <ul className="divide-y divide-border text-sm">
              {items.map((i) => (
                <li key={i.code} className="flex items-center justify-between gap-2 py-2">
                  <span>{i.subject || i.type.replace(/_/g, " ").toLowerCase()} <span className="text-xs text-muted">({i.code})</span></span>
                  <span className="text-xs text-muted">{i.status.replace(/_/g, " ").toLowerCase()} · {new Date(i.createdAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
