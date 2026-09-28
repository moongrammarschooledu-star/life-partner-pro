"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Send, ShieldQuestion } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

const TYPES: Array<{ value: string; label: string }> = [
  { value: "SUSPICIOUS_PROFILE", label: "A profile that seems suspicious" },
  { value: "INAPPROPRIATE_COMMUNICATION", label: "Inappropriate communication" },
  { value: "IDENTITY_CONCERN", label: "Someone may not be who they say they are" },
  { value: "CONTACT_ABUSE", label: "Unwanted or unauthorized contact" },
  { value: "HARASSMENT", label: "Harassment or threats" },
  { value: "IMPERSONATION", label: "Someone may be impersonating another person" },
  { value: "OTHER", label: "Something else" },
];

interface OwnReport { reportCode: string; reportType: string; status: string; resolutionNote: string | null; createdAt: string }

// "Report a Concern" - deliberately neutral. It tells the member their report will be reviewed by a person, that it is
// treated as information rather than proof, and it never shows anything about the other profile or any internal state.
export default function ReportConcernPage() {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [reports, setReports] = useState<OwnReport[]>([]);
  const [reportType, setReportType] = useState("SUSPICIOUS_PROFILE");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  function load() {
    fetch("/api/my-reports")
      .then(async (res) => {
        if (!res.ok) return setSignedIn(false);
        setSignedIn(true);
        setReports(((await res.json()) as { items: OwnReport[] }).items);
      })
      .catch(() => setSignedIn(false));
  }
  useEffect(load, []);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/my-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportType, description, reportedProfileCode: code.trim() || undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { show(json.error ?? "Could not send your report.", "error"); return; }
      setSent(json.reportCode);
      setDescription(""); setCode("");
      show("Your report was received.", "success");
      load();
    } finally {
      setSubmitting(false);
    }
  }

  if (signedIn === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Report a Concern</h1>
        <p className="mt-2 text-sm text-muted">Please <Link href="/my-status" className="text-primary hover:underline">sign in with your Profile ID</Link> to send a report.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="text-sm text-muted hover:text-foreground">&larr; Back to dashboard</Link>
      <h1 className="mt-2 flex items-center gap-2 font-heading text-2xl font-semibold"><ShieldQuestion className="h-6 w-6" /> Report a Concern</h1>
      <p className="mt-2 text-sm text-muted">If something feels wrong, tell us. Your report is reviewed confidentially by a member of our team. It is treated as information to look into — not as proof — and nothing happens to anyone automatically.</p>

      {sent && <p className="mt-4 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">Thank you. Your report ({sent}) has been received and will be reviewed by our team.</p>}

      <Card className="mt-4">
        <CardContent className="space-y-4">
          <Field label="What is your concern about?" htmlFor="rc-type">
            <Select id="rc-type" value={reportType} onChange={(e) => setReportType(e.target.value)}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
          </Field>
          <Field label="Profile ID (optional)" htmlFor="rc-code" hint="Only if this is about a specific profile.">
            <Input id="rc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="LPP-000123" autoComplete="off" />
          </Field>
          <Field label="What happened?" htmlFor="rc-desc" hint="Please stick to what you saw or experienced. Avoid sharing phone numbers or other personal details.">
            <Textarea id="rc-desc" className="min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
          <Button onClick={submit} disabled={submitting || description.trim().length < 10} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send report
          </Button>
        </CardContent>
      </Card>

      {reports.length > 0 && (
        <div className="mt-8">
          <h2 className="font-heading text-lg font-semibold">Your reports</h2>
          <ul className="mt-2 space-y-2">
            {reports.map((r) => (
              <li key={r.reportCode} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs">{r.reportCode}</span><Badge variant="muted">{formatEnumLabel(r.status)}</Badge></div>
                <p className="text-xs text-muted">{formatEnumLabel(r.reportType)} · {formatDateTime(r.createdAt)}</p>
                {r.resolutionNote && <p className="mt-1 text-sm">{r.resolutionNote}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
