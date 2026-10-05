"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Copy, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

interface ReferralData {
  codes: Array<{ code: string; program: string; active: boolean; shareLink?: string }>;
  summary: { totalReferred: number; qualified: number; rewarded: number; underReview?: number };
  history?: Array<{ label: string; statusLabel: { EN: string; UR: string }; date: string; reward: { type: string; status: string } | null }>;
  note?: string;
}

// STEP 27 §42/§43 — the referrer only ever sees aggregate counts here,
// never anything about who they referred.
export default function ReferralsPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [linkCode, setLinkCode] = useState("");
  const [linkMessage, setLinkMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () => fetch("/api/my-referrals").then((r) => (r.ok ? r.json() : null)).then(setData);

  useEffect(() => {
    load();
  }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/my-referrals", { method: "POST" });
      if (res.ok) await load();
    } finally {
      setGenerating(false);
    }
  };

  const submitLink = async () => {
    setLinkMessage(null);
    const res = await fetch("/api/my-referrals/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: linkCode }) });
    const json = await res.json();
    setLinkMessage(res.ok ? "Referral linked. Thank you!" : json.error ?? "Could not link this code.");
    if (res.ok) setLinkCode("");
  };

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-16 sm:px-6">
      <div>
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold">Referrals</h1>
        <p className="mt-1 text-sm text-muted">Share your code. We never show you who used it — only whether it qualified.</p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="font-medium">Your Referral Code</h2>
          {data.codes.length === 0 ? (
            <Button size="sm" onClick={generate} disabled={generating}>{generating ? "Generating..." : "Get My Referral Code"}</Button>
          ) : (
            data.codes.map((c) => (
              <div key={c.code} className="space-y-2">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted p-3">
                  <span className="font-mono text-sm font-semibold">{c.code}</span>
                  <Button size="sm" variant="outline" onClick={() => copyCode(c.code)}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</Button>
                </div>
                {c.shareLink && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted">Share this link. When someone registers through it, your code is applied for them.</p>
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted p-3">
                      <span className="min-w-0 break-all text-xs">{c.shareLink}</span>
                      <Button size="sm" variant="outline" onClick={() => copyCode(c.shareLink as string)}><Copy className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-semibold">{data.summary.totalReferred}</p>
            <p className="text-xs text-muted">Referred</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{data.summary.qualified}</p>
            <p className="text-xs text-muted">Qualified</p>
          </div>
          <div>
            <p className="text-2xl font-semibold">{data.summary.rewarded}</p>
            <p className="text-xs text-muted">Rewarded</p>
          </div>
        </CardContent>
      </Card>

      {data.history && data.history.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="font-medium">Your referrals</h2>
            <ul className="divide-y divide-border text-sm">
              {data.history.map((h, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <span>{h.label}</span>
                  <span className="text-xs text-muted">{h.statusLabel.EN}{h.reward ? ` · reward ${h.reward.status.toLowerCase()}` : ""} · {h.date}</span>
                </li>
              ))}
            </ul>
            {data.note && <p className="text-xs text-muted">{data.note}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2">
          <h2 className="font-medium">Have a referral code?</h2>
          <div className="flex gap-2">
            <Input value={linkCode} onChange={(e) => setLinkCode(e.target.value)} placeholder="LPP-XXXX-0000" />
            <Button size="sm" onClick={submitLink} disabled={!linkCode.trim()}>Apply</Button>
          </div>
          {linkMessage && <p className="text-sm text-muted">{linkMessage}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
