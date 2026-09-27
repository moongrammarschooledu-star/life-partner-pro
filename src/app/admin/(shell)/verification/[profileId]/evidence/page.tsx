"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface EvidenceResponse {
  verification: { status: string; phoneVerifiedAt: string | null; emailVerifiedAt: string | null; providerName: string | null; providerStatus: string | null; items: { itemKey: string; status: string; completedAt: string | null }[]; lastReviewedAt: string | null } | null;
  documents: { id: string; documentType: string; reviewStatus: string; uploadedAt: string; reviewedAt: string | null }[];
  otpEvents: { id: string; channel: string; destinationMasked: string; status: string; createdAt: string }[];
  duplicateSignals: { id: string; candidateCode: string; confidenceBand: string; status: string; createdAt: string }[];
  riskSignals: { id: string; flagType: string; severity: string; status: string; createdAt: string }[];
  adminReviews: { id: string; text: string; adminName: string; createdAt: string }[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function EvidenceCenterPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const [data, setData] = useState<EvidenceResponse | null>(null);

  useEffect(() => {
    fetch(`/api/admin/verification/${profileId}/evidence`)
      .then((r) => r.json())
      .then(setData);
  }, [profileId]);

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href={`/admin/verification/${profileId}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Verification Review
      </Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold">Evidence Center</h1>
        <p className="text-sm text-muted">A complete, read-only view of every verification, duplicate, and risk record for this profile. Every view here is access-logged.</p>
      </div>

      <Section title="Verification Result">
        {data.verification ? (
          <div className="space-y-1 text-sm">
            <p className="flex items-center gap-2"><StatusBadge status={data.verification.status} /> {data.verification.providerName ? `via ${data.verification.providerName} (${data.verification.providerStatus})` : ""}</p>
            <p className="text-muted">Phone verified: {data.verification.phoneVerifiedAt ? formatDateTime(data.verification.phoneVerifiedAt) : "No"}</p>
            <p className="text-muted">Email verified: {data.verification.emailVerifiedAt ? formatDateTime(data.verification.emailVerifiedAt) : "No"}</p>
            {data.verification.lastReviewedAt && <p className="text-muted">Last reviewed: {formatDateTime(data.verification.lastReviewedAt)}</p>}
            <ul className="mt-2 space-y-1">
              {data.verification.items.map((i) => (
                <li key={i.itemKey} className="flex justify-between border-b border-border py-1 last:border-0">
                  <span>{formatEnumLabel(i.itemKey)}</span>
                  <StatusBadge status={i.status} />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted">No verification record yet.</p>
        )}
      </Section>

      <Section title="Documents">
        {data.documents.length === 0 ? (
          <p className="text-sm text-muted">No documents uploaded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.documents.map((d) => (
              <li key={d.id} className="flex justify-between border-b border-border py-1 last:border-0">
                <span>{formatEnumLabel(d.documentType)} · uploaded {formatDateTime(d.uploadedAt)}</span>
                <StatusBadge status={d.reviewStatus} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Contact Verification Events">
        {data.otpEvents.length === 0 ? (
          <p className="text-sm text-muted">No contact verification events.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.otpEvents.map((o) => (
              <li key={o.id} className="flex justify-between border-b border-border py-1 last:border-0">
                <span>{formatEnumLabel(o.channel)} · {o.destinationMasked} · {formatDateTime(o.createdAt)}</span>
                <StatusBadge status={o.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Duplicate Signals">
        {data.duplicateSignals.length === 0 ? (
          <p className="text-sm text-muted">No duplicate signals.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.duplicateSignals.map((c) => (
              <li key={c.id} className="flex justify-between border-b border-border py-1 last:border-0">
                <span>{c.candidateCode} · {formatEnumLabel(c.confidenceBand)} confidence · {formatDateTime(c.createdAt)}</span>
                <StatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Risk Signals">
        {data.riskSignals.length === 0 ? (
          <p className="text-sm text-muted">No risk signals.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.riskSignals.map((f) => (
              <li key={f.id} className="flex justify-between border-b border-border py-1 last:border-0">
                <span>{formatEnumLabel(f.flagType)} · {formatEnumLabel(f.severity)} · {formatDateTime(f.createdAt)}</span>
                <StatusBadge status={f.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Admin Reviews">
        {data.adminReviews.length === 0 ? (
          <p className="text-sm text-muted">No admin notes.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.adminReviews.map((n) => (
              <li key={n.id} className="border-b border-border pb-2 last:border-0">
                <p>{n.text}</p>
                <p className="text-xs text-muted">{n.adminName} · {formatDateTime(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
