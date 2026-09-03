"use client";

import { useState } from "react";
import { Clock, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

interface PendingUpdate {
  id: string;
  payload: { contact?: Record<string, unknown>; preference?: Record<string, unknown> };
  submittedAt: string | Date;
}

export function PendingUpdateCard({ profileId, pendingUpdate, onResolved }: { profileId: string; pendingUpdate: PendingUpdate; onResolved: () => void }) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function resolve(decision: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/profiles/${profileId}/pending-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error();
      show(decision === "approve" ? "Update approved" : "Update rejected", "success");
      onResolved();
    } catch {
      show("Could not process this request.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-warning">
          <Clock className="h-4 w-4" /> Pending Update Request
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">Submitted {formatDateTime(pendingUpdate.submittedAt)}</p>
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-xs">{JSON.stringify(pendingUpdate.payload, null, 2)}</pre>
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => resolve("approve")}>
            <Check className="h-4 w-4" /> Approve
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => resolve("reject")}>
            <X className="h-4 w-4" /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
