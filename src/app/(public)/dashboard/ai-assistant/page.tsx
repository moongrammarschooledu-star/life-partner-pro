"use client";

import { useState } from "react";
import { Loader2, Sparkles, Lightbulb } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface AiPayload {
  summary: string;
  missingInformation: string[];
  verificationQuestions: string[];
  potentialConflicts: string[];
  suggestedNextStep: string | null;
  limitations: string[];
  sufficiency: string;
  data?: { suggestions?: string[] };
}

// STEP 21 Decision 8 — the one applicant-facing AI feature: rule-based,
// self-profile-only improvement suggestions. Never a compatibility score,
// never another profile's data.
export default function AiAssistantPage() {
  const { show } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AiPayload | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/my-ai/profile-improvement", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not generate suggestions.", "error");
        return;
      }
      setResult(json.payload);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Profile Assistant</h1>
        <p className="mt-1 text-sm text-muted">
          Automated, rule-based suggestions for your own profile only — never a compatibility score or a guarantee of match success.
        </p>
      </div>

      <Button onClick={run} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Get Suggestions
      </Button>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4" /> {result.summary}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {result.data?.suggestions && result.data.suggestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggestions</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {result.data.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {result.verificationQuestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">To Verify or Confirm</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {result.verificationQuestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            <div className="border-t border-border pt-2 text-xs text-muted">
              {result.limitations.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
