"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2, CircleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";

interface Funnel {
  windowDays: number;
  collecting: boolean;
  stages: Array<{ key: string; label: string; count: number; source: "site" | "platform" }>;
  status: { canonicalBaseConfigured: boolean; legalPagesReviewed: boolean; governingLawConfigured: boolean; siteEventsEnabled: boolean; contentReviewRequired: boolean };
}

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
      <span>
        <span className="font-medium">{label}</span> <span className="text-muted">— {hint}</span>
      </span>
    </li>
  );
}

export function PublicSiteClient() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<Funnel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/public-site?days=${days}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not load."))))
      .then((j) => live && setData(j))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [days]);

  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  const s = data.status;
  const top = Math.max(1, ...data.stages.map((x) => x.count));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Public Website</h1>
        <p className="text-sm text-muted">How visitors move from the public pages to an active applicant, and whether the site is configured for search engines and legal pages.</p>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <p className="font-medium">Site checks</p>
          <ul className="space-y-2">
            <Check ok={s.canonicalBaseConfigured} label="Public web address" hint={s.canonicalBaseConfigured ? "Sitemap and canonical links use it." : "Not configured: the sitemap is empty until APP_URL is set."} />
            <Check ok={s.legalPagesReviewed} label="Privacy policy and terms reviewed" hint={s.legalPagesReviewed ? "The pending-review notice is hidden." : "A “pending legal review” notice is shown. Set LEGAL_PAGES_REVIEWED=true after review."} />
            <Check ok={s.governingLawConfigured} label="Governing-law wording" hint={s.governingLawConfigured ? "Shown in the terms." : "Not shown yet. Set LEGAL_GOVERNING_LAW with your own wording."} />
            <Check ok={s.siteEventsEnabled} label="Visitor counting" hint={s.siteEventsEnabled ? "On (anonymous, honours Do Not Track)." : "Off. Turn on “marketing.site_events.enabled” to count visits."} />
            <Check ok={s.contentReviewRequired} label="Second-person review for articles" hint={s.contentReviewRequired ? "Required before publishing." : "Not required: the editor may publish their own article."} />
          </ul>
          <p className="text-xs text-muted">
            Technical files: <Link href="/sitemap.xml" className="underline" target="_blank">sitemap.xml</Link> · <Link href="/robots.txt" className="underline" target="_blank">robots.txt</Link> · <Link href="/manifest.webmanifest" className="underline" target="_blank">manifest</Link>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Acquisition funnel</p>
            <Select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className="w-40">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </Select>
          </div>
          {!data.collecting && <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">Visitor counting is off, so the first four rows stay at zero. The rows from “Registered” on come from platform records and are always shown.</p>}
          <ul className="space-y-2">
            {data.stages.map((st) => (
              <li key={st.key}>
                <div className="flex items-center justify-between text-sm">
                  <span>{st.label} <Badge variant="muted" className="ml-1">{st.source === "site" ? "site" : "platform"}</Badge></span>
                  <span className="font-semibold">{st.count}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-muted"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((st.count / top) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">The two sources are counted differently, so use this to watch trends rather than to compute exact conversion rates. A registered account is not an active applicant: “Active” is its own, later step. No personal or matrimonial information is stored by the visitor counter.</p>
        </CardContent>
      </Card>
    </div>
  );
}
