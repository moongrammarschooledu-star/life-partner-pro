"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Search, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { categoriesForType } from "@/lib/case-categories";
import { formatEnumLabel } from "@/lib/utils";
import type { CaseType } from "@prisma/client";

const TYPE_OPTIONS: { value: CaseType; label: string; description: string }[] = [
  { value: "SUPPORT", label: "Support Request", description: "Help with your account, profile, verification, matching, or a technical issue." },
  { value: "COMPLAINT", label: "Complaint", description: "Report incorrect information, unwanted contact, misuse, or a proposal/meeting issue." },
  { value: "SAFETY_REPORT", label: "Safety Concern", description: "Report harassment, fraud, a fake profile, or another safety issue." },
];

function NewCaseForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { show } = useToast();

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  const [type, setType] = useState<CaseType>((searchParams.get("type") as CaseType) || "SUPPORT");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [reportedProfileCode, setReportedProfileCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [possibleDuplicates, setPossibleDuplicates] = useState<{ id: string; caseNumber: string; subject: string }[] | null>(null);

  useEffect(() => {
    fetch("/api/my-cases")
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false));
  }, []);

  async function lookup() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Profile not found.", "error");
        return;
      }
      setSignedIn(true);
    } finally {
      setLookingUp(false);
    }
  }

  async function submit() {
    if (!category || !subject.trim() || !description.trim()) {
      show("Please fill in the category, subject, and description.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/my-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, category, subject, description, reportedProfileCode: reportedProfileCode || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not submit your request.", "error");
        return;
      }
      if (json.possibleDuplicates?.length > 0) {
        setPossibleDuplicates(json.possibleDuplicates);
      }
      show(`Request submitted — ${json.caseNumber}`, "success");
      router.push(`/my-cases/${json.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (signedIn === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Create a Request</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to continue.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/my-cases" className="text-sm text-muted hover:text-foreground">&larr; Back to Help &amp; Support</Link>
      <h1 className="mt-2 font-heading text-2xl font-semibold">Create a Request</h1>

      {type === "SAFETY_REPORT" && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          Your report will be reviewed confidentially by the authorized Life Partner Pro team.
        </p>
      )}

      <Card className="mt-4">
        <CardContent className="space-y-4">
          <Field label="What is this about?" htmlFor="type">
            <Select id="type" value={type} onChange={(e) => { setType(e.target.value as CaseType); setCategory(""); }}>
              {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
            <p className="mt-1 text-xs text-muted">{TYPE_OPTIONS.find((t) => t.value === type)?.description}</p>
          </Field>

          <Field label="Category" htmlFor="category">
            <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Select a category…</option>
              {categoriesForType(type).map((c) => <option key={c} value={c}>{formatEnumLabel(c)}</option>)}
            </Select>
          </Field>

          {(type === "COMPLAINT" || type === "SAFETY_REPORT") && (
            <Field label="Profile ID being reported (optional)" htmlFor="reportedProfileCode" hint="Only if this is about a specific profile.">
              <Input id="reportedProfileCode" value={reportedProfileCode} onChange={(e) => setReportedProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
          )}

          <Field label="Subject" htmlFor="subject">
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>

          <Field label="Description" htmlFor="description">
            <Textarea id="description" className="min-h-32" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          {possibleDuplicates && possibleDuplicates.length > 0 && (
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
              <p className="font-medium">You may have an existing similar request:</p>
              {possibleDuplicates.map((d) => (
                <Link key={d.id} href={`/my-cases/${d.id}`} className="block text-primary hover:underline">
                  {d.caseNumber} — {d.subject}
                </Link>
              ))}
            </div>
          )}

          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Request
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NewCasePage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>}>
      <NewCaseForm />
    </Suspense>
  );
}
