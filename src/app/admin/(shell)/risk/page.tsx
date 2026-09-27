"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldQuestion } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface RiskSignal {
  id: string;
  flagType: string;
  severity: string;
  status: string;
  description: string;
  createdAt: string;
  profile: { id: string; profileCode: string; fullName: string };
  assignedTo: { name: string } | null;
}

const SEVERITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

// Every action here calls the existing PATCH /api/admin/security-flags/[id]
// route (extended in STEP 23 to also accept risk:review/risk:resolve) —
// SecurityFlag is the single risk-signal store this page and Security Flags
// both read/write, filtered to different flagType subsets.
function SignalRow({ signal, onUpdated }: { signal: RiskSignal; onUpdated: () => void }) {
  const { show } = useToast();
  const [showResolve, setShowResolve] = useState(false);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  async function updateStatus(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/security-flags/${signal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolution: status === "RESOLVED" || status === "DISMISSED" ? resolution : undefined }),
      });
      if (!res.ok) throw new Error();
      show("Risk signal updated", "success");
      setShowResolve(false);
      onUpdated();
    } catch {
      show("Could not update this signal.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/admin/profiles/${signal.profile.id}`} className="font-medium text-primary hover:underline">
            {signal.profile.fullName}
          </Link>
          <span className="ml-1 text-xs text-muted">({signal.profile.profileCode})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={SEVERITY_VARIANT[signal.severity]}>{formatEnumLabel(signal.severity)}</Badge>
          <StatusBadge status={signal.status} />
        </div>
      </div>
      <p className="mt-1 font-medium">{formatEnumLabel(signal.flagType)}</p>
      <p className="text-xs text-muted">{signal.description}</p>
      <p className="mt-1 text-xs text-muted">
        {formatDateTime(signal.createdAt)} {signal.assignedTo ? `· Assigned to ${signal.assignedTo.name}` : ""}
      </p>
      {signal.status !== "RESOLVED" && signal.status !== "DISMISSED" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => updateStatus("INVESTIGATING")} disabled={busy}>
            Investigate
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowResolve((s) => !s)} disabled={busy}>
            Resolve / Dismiss
          </Button>
        </div>
      )}
      {showResolve && (
        <div className="mt-2 space-y-2">
          <Textarea rows={2} placeholder="Resolution notes" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => updateStatus("RESOLVED")} disabled={busy}>
              Mark Resolved
            </Button>
            <Button size="sm" variant="ghost" onClick={() => updateStatus("DISMISSED")} disabled={busy}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RiskSignalsPage() {
  const [signals, setSignals] = useState<RiskSignal[] | null>(null);
  const [tab, setTab] = useState("open");

  function load() {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("status", tab.toUpperCase());
    fetch(`/api/admin/risk/signals?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => setSignals(json.items ?? []));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Risk Signals</h1>
        <p className="text-sm text-muted">
          Explainable, review-required signals — rapid registration, contact reuse, excessive proposal or contact-request activity, and payment
          anomalies. A signal is not proof of wrongdoing; every action here requires a human decision.
        </p>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "open", label: "Open" },
          { value: "investigating", label: "Investigating" },
          { value: "resolved", label: "Resolved" },
          { value: "dismissed", label: "Dismissed" },
          { value: "all", label: "All" },
        ]}
      />

      <Card>
        <CardContent>
          {signals === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : signals.length === 0 ? (
            <EmptyState icon={ShieldQuestion} title="No risk signals here" />
          ) : (
            <div className="space-y-2">
              {signals.map((s) => (
                <SignalRow key={s.id} signal={s} onUpdated={load} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
