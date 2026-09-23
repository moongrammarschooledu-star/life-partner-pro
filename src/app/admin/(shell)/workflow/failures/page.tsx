"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface FailureRow {
  id: string;
  stage: string;
  errorMessage: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionReason: string | null;
  createdAt: string;
  workflowEvent: { id: string; eventName: string; attempts: number; status: string } | null;
  task: { id: string; taskCode: string | null; title: string | null } | null;
  resolvedBy: { id: string; name: string } | null;
}

// STEP 18 §66 — Admin → Workflow Failures. No automation event is ever
// silently discarded; unresolved failures stay visible here until a human
// inspects, retries, or explicitly resolves/ignores them with a reason.
export default function WorkflowFailuresPage() {
  const { show } = useToast();
  const [items, setItems] = useState<FailureRow[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setItems(null);
    fetch(`/api/admin/workflow-failures?resolved=${showResolved}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  async function retry(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/workflow-failures/${id}/retry`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Retry failed.", "error");
        return;
      }
      show("Retried successfully", "success");
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function resolve(id: string, resolution: "RESOLVED" | "IGNORED") {
    const reason = window.prompt(`Reason for marking this ${resolution.toLowerCase()}:`);
    if (!reason?.trim()) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/workflow-failures/${id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not resolve.", "error");
        return;
      }
      show("Updated", "success");
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/workflow" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Workflow &amp; Tasks
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Workflow Failures</h1>
          <p className="text-sm text-muted">Automation events that failed — nothing is ever silently discarded.</p>
        </div>
        <Checkbox label="Show resolved" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
      </div>

      {items === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No workflow failures" description="Every automated task creation has succeeded." />
      ) : (
        <div className="space-y-2">
          {items.map((f) => (
            <Card key={f.id}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Badge variant="danger">{formatEnumLabel(f.stage)}</Badge>
                    {f.workflowEvent && <span className="ml-2 text-xs text-muted">{f.workflowEvent.eventName} (attempt {f.workflowEvent.attempts})</span>}
                  </div>
                  <span className="text-xs text-muted">{formatDateTime(f.createdAt)}</span>
                </div>
                <p className="text-sm text-danger">{f.errorMessage}</p>
                {f.task && (
                  <Link href={`/admin/workflow/${f.task.id}`} className="text-xs font-medium text-primary hover:underline">
                    {f.task.taskCode ?? f.task.id}
                  </Link>
                )}
                {f.resolvedAt ? (
                  <p className="text-xs text-muted">
                    {formatEnumLabel(f.resolution ?? "")} by {f.resolvedBy?.name ?? "—"} — {f.resolutionReason}
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => retry(f.id)} disabled={busyId === f.id || !f.workflowEvent}>
                      <RefreshCw className="h-3.5 w-3.5" /> Retry
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolve(f.id, "RESOLVED")} disabled={busyId === f.id}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => resolve(f.id, "IGNORED")} disabled={busyId === f.id}>
                      <XCircle className="h-3.5 w-3.5" /> Ignore
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
