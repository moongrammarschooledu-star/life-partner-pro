"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatEnumLabel } from "@/lib/utils";

interface EvidenceSummary {
  verification: { status: string; phoneVerifiedAt: string | null; emailVerifiedAt: string | null } | null;
  duplicateSignals: { status: string }[];
  riskSignals: { status: string; severity: string }[];
}

// Spec §48 — a compact, always-current summary; the full detail lives in the
// Evidence Center this links to. Silently renders nothing if the viewing
// admin lacks sensitive:verification:view (a 403/404 from the endpoint) —
// this card is an enhancement, not a required part of the page.
export function TrustSummaryCard({ profileId }: { profileId: string }) {
  const [data, setData] = useState<EvidenceSummary | null | "forbidden">(null);

  useEffect(() => {
    fetch(`/api/admin/verification/${profileId}/evidence`)
      .then((r) => (r.ok ? r.json() : "forbidden"))
      .then(setData)
      .catch(() => setData("forbidden"));
  }, [profileId]);

  if (!data || data === "forbidden") return null;

  const openRisk = data.riskSignals.filter((s) => s.status === "OPEN" || s.status === "INVESTIGATING");
  const openHighRisk = openRisk.filter((s) => s.severity === "HIGH" || s.severity === "CRITICAL");
  const openDuplicates = data.duplicateSignals.filter((s) => s.status === "POTENTIAL_DUPLICATE" || s.status === "DUPLICATE_REVIEW_REQUIRED");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trust & Verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">Contact</span>
          <span>{data.verification?.phoneVerifiedAt && data.verification?.emailVerifiedAt ? "✓ Phone & Email Verified" : "Incomplete"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Identity</span>
          <span className="flex items-center gap-1">
            {data.verification?.status === "VERIFIED" ? <ShieldCheck className="h-3.5 w-3.5 text-success" /> : <ShieldQuestion className="h-3.5 w-3.5 text-muted" />}
            {formatEnumLabel(data.verification?.status ?? "NOT_VERIFIED")}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Duplicate Review</span>
          <span>{openDuplicates.length > 0 ? `${openDuplicates.length} Open` : "No Open Review"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Risk</span>
          <span className="flex items-center gap-1">
            {openHighRisk.length > 0 && <ShieldAlert className="h-3.5 w-3.5 text-danger" />}
            {openHighRisk.length > 0 ? `${openHighRisk.length} High-Severity Signal(s)` : openRisk.length > 0 ? `${openRisk.length} Open Signal(s)` : "No Open Signals"}
          </span>
        </div>
        <Link href={`/admin/verification/${profileId}/evidence`} className="block pt-1 text-xs font-medium text-primary hover:underline">
          Open Evidence Center
        </Link>
      </CardContent>
    </Card>
  );
}
