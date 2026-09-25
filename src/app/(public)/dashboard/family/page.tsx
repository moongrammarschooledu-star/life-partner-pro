"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Users, MessageSquarePlus, UserPlus, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

interface FamilyInteraction {
  id: string;
  proposalId: string;
  contactPerson: string;
  relationship: string;
  communicationMethod: string;
  communicationDate: string;
  outcome: string | null;
  nextFollowUpDate: string | null;
}

// STEP 21 Decision 5 — admin-mediated family outreach (this page's own
// interaction log) stays exactly as-is. STEP 22 adds a SEPARATE, genuinely
// new capability alongside it: inviting a family member to their own
// password-based account with scoped, delegated, revocable access — see
// /dashboard/family/members and /dashboard/family/access. The two are
// complementary, not a replacement of one by the other.
export default function FamilyInteractionPage() {
  const [items, setItems] = useState<FamilyInteraction[] | null>(null);

  useEffect(() => {
    fetch("/api/my-family/interactions")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setItems(j?.items ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Family Interaction</h1>
          <p className="mt-1 text-sm text-muted">A record of family outreach handled by our team on your behalf.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/family/members">
            <Button size="sm" variant="outline"><UserPlus className="h-4 w-4" /> Invite Family Member</Button>
          </Link>
          <Link href="/dashboard/family/access">
            <Button size="sm" variant="outline"><ShieldCheck className="h-4 w-4" /> Manage Access</Button>
          </Link>
          <Link href="/my-cases/new?type=SUPPORT&category=FAMILY_INTERACTION_REQUEST">
            <Button size="sm"><MessageSquarePlus className="h-4 w-4" /> Request Family Outreach</Button>
          </Link>
        </div>
      </div>

      {items === null ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState icon={Users} title="No family interactions recorded yet" description="Once our team reaches out to a family member on your behalf, it will appear here." /></CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Interaction History</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {items.map((f) => (
              <div key={f.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{f.contactPerson} ({f.relationship})</p>
                <p className="text-xs text-muted">{f.communicationMethod} — {formatDateTime(f.communicationDate)}</p>
                {f.outcome && <p className="mt-1 text-sm">{f.outcome}</p>}
                {f.nextFollowUpDate && <p className="mt-1 text-xs text-muted">Next follow-up: {formatDateTime(f.nextFollowUpDate)}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
