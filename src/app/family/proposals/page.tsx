"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Heart } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

interface ProposalSummary {
  proposalCode: string;
  createdAt: string;
  status: string;
  canComment: boolean;
  canRespond: boolean;
  otherProfile: { fullName: string; age: number; city: string; country: string };
}

export default function FamilyProposalsPage() {
  const [items, setItems] = useState<ProposalSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/family/proposals").then((r) => (r.ok ? r.json() : null)).then((j) => setItems(j?.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Proposals</h1>
        <p className="mt-1 text-sm text-muted">Only proposals explicitly shared with you appear here.</p>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState icon={Heart} title="No proposals shared with you yet" /></CardContent></Card>
      ) : (
        items.map((p) => (
          <Link key={p.proposalCode} href={`/family/proposals/${p.proposalCode}`}>
            <Card className="transition-colors hover:border-primary">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{p.otherProfile.fullName}, {p.otherProfile.age}</span>
                  <Badge variant="muted">{p.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted">
                {p.otherProfile.city}, {p.otherProfile.country} · Shared {formatDateTime(p.createdAt)}
                {p.canRespond && <span className="ml-2 text-primary">· You can suggest a response</span>}
              </CardContent>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
