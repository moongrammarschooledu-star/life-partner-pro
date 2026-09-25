"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface PendingPermission {
  id: string;
  permission: string;
  grantedAt: string;
  familyMember: { fullName: string; relationship: string; familyAccount: { applicant: { profileCode: string } } };
}

// STEP 19 checker queue for FAMILY_ACCESS_GRANT — every sensitive family
// permission an applicant has granted, awaiting admin approval before it
// activates (src/lib/family/grants.ts).
export default function PendingFamilyApprovalsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<PendingPermission[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/family/permissions/pending").then((r) => (r.ok ? r.json() : null)).then((j) => setItems(j?.items ?? []));
  }
  useEffect(load, []);

  async function decide(id: string, decision: "approve" | "reject") {
    const reason = prompt(`Reason for this ${decision}:`);
    if (!reason) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/family/permissions/${id}/decide`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) });
      const json = await res.json();
      if (res.status === 202) { show(`Requires further approval — ${json.approvalCode}`, "info"); load(); return; }
      if (!res.ok) { show(json.error ?? "Could not process.", "error"); return; }
      show(`Permission ${decision}d.`, "success");
      load();
    } finally {
      setBusy(null);
    }
  }

  if (items === null) return <div className="flex h-64 items-center justify-center p-6"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4 p-6">
      <Link href="/admin/family-accounts" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Family Accounts</Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold">Pending Family Permission Approvals</h1>
        <p className="text-sm text-muted">Sensitive family-member permissions require admin approval before they activate.</p>
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-8"><EmptyState title="No pending approvals" /></CardContent></Card>
      ) : (
        items.map((p) => (
          <Card key={p.id}>
            <CardHeader><CardTitle className="text-base">{formatEnumLabel(p.permission.replace(/\./g, "_"))}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{p.familyMember.fullName} ({p.familyMember.relationship}) — applicant {p.familyMember.familyAccount.applicant.profileCode}</p>
              <p className="text-xs text-muted">Requested {formatDateTime(p.grantedAt)}</p>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => decide(p.id, "approve")} disabled={busy === p.id}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => decide(p.id, "reject")} disabled={busy === p.id}>Reject</Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
