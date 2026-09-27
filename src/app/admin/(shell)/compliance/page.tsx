"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Globe2, ScrollText, Building2, Gavel, Lock, ArrowUpRight } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";

interface DashboardResponse {
  kpis: {
    jurisdictionCount: number;
    activeRuleCount: number;
    rulesDueForReview: number;
    processorsDueForReview: number;
    authorityRequestsAwaitingReview: number;
    holdsPendingRelease: number;
    transfersReviewRequired: number;
  };
  rulesDueForReview: Array<{ id: string; ruleCode: string; requirementType: string; reviewDate: string | null }>;
  processorsDueForReview: Array<{ id: string; processorCode: string; name: string; complianceStatus: string }>;
  authorityRequestsAwaitingReview: Array<{ id: string; requestCode: string; authority: string; legalReviewStatus: string; deadline: string | null }>;
  holdsPendingRelease: Array<{ id: string; reason: string }>;
}

// STEP 23 Add-on — Compliance Center dashboard. Every number here is a real
// count from the new tables; nothing is a computed "compliance score" (the
// spec explicitly forbids inventing a legal conclusion, and a single score
// would imply one).
export default function ComplianceDashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);

  useEffect(() => {
    fetch("/api/admin/compliance/dashboard")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Compliance</h1>
        <p className="text-sm text-muted">
          Legal Jurisdiction Safeguards &amp; Regulatory Compliance Framework. Every check here is conservative by design — an unresolved
          jurisdiction or rule is flagged for human review, never assumed.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Link href="/admin/compliance/jurisdictions">
          <StatCard icon={Globe2} label="Jurisdictions" value={kpis.jurisdictionCount} accent="primary" />
        </Link>
        <Link href="/admin/compliance/rules">
          <StatCard icon={ScrollText} label="Active rules" value={kpis.activeRuleCount} accent="primary" />
        </Link>
        <Link href="/admin/compliance/reviews">
          <StatCard icon={ScrollText} label="Rules due for review" value={kpis.rulesDueForReview} accent={kpis.rulesDueForReview > 0 ? "warning" : "muted"} />
        </Link>
        <Link href="/admin/compliance/processors">
          <StatCard icon={Building2} label="Processors due for review" value={kpis.processorsDueForReview} accent={kpis.processorsDueForReview > 0 ? "warning" : "muted"} />
        </Link>
        <Link href="/admin/compliance/authority-requests">
          <StatCard icon={Gavel} label="Authority requests awaiting review" value={kpis.authorityRequestsAwaitingReview} accent={kpis.authorityRequestsAwaitingReview > 0 ? "danger" : "muted"} />
        </Link>
        <Link href="/admin/privacy-center">
          <StatCard icon={Lock} label="Holds pending release" value={kpis.holdsPendingRelease} accent={kpis.holdsPendingRelease > 0 ? "warning" : "muted"} />
        </Link>
        <Link href="/admin/compliance/reviews">
          <StatCard icon={ArrowUpRight} label="Transfers needing review" value={kpis.transfersReviewRequired} accent={kpis.transfersReviewRequired > 0 ? "warning" : "muted"} />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent>
            <h2 className="mb-3 font-medium">Rules due for review</h2>
            {data.rulesDueForReview.length === 0 ? (
              <EmptyState icon={ScrollText} title="Nothing due" />
            ) : (
              <div className="space-y-2">
                {data.rulesDueForReview.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                    <div>
                      <p className="font-mono text-xs">{r.ruleCode}</p>
                      <p className="text-muted">{r.requirementType}</p>
                    </div>
                    <span className="text-xs text-muted">{r.reviewDate ? formatDate(r.reviewDate) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="mb-3 font-medium">Authority requests awaiting legal review</h2>
            {data.authorityRequestsAwaitingReview.length === 0 ? (
              <EmptyState icon={Gavel} title="Nothing pending" />
            ) : (
              <div className="space-y-2">
                {data.authorityRequestsAwaitingReview.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                    <div>
                      <p className="font-mono text-xs">{r.requestCode}</p>
                      <p className="text-muted">{r.authority}</p>
                    </div>
                    <StatusBadge status={r.legalReviewStatus} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="mb-3 font-medium">Processors due for review</h2>
            {data.processorsDueForReview.length === 0 ? (
              <EmptyState icon={Building2} title="Nothing due" />
            ) : (
              <div className="space-y-2">
                {data.processorsDueForReview.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                    <div>
                      <p className="font-mono text-xs">{p.processorCode}</p>
                      <p className="text-muted">{p.name}</p>
                    </div>
                    <StatusBadge status={p.complianceStatus} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="mb-3 font-medium">Holds pending release approval</h2>
            {data.holdsPendingRelease.length === 0 ? (
              <EmptyState icon={Lock} title="Nothing pending" />
            ) : (
              <div className="space-y-2">
                {data.holdsPendingRelease.map((h) => (
                  <div key={h.id} className="rounded-lg border border-border p-2 text-sm">
                    <p className="text-muted">{h.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
