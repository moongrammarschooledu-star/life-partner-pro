"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Copy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface DuplicateCandidateItem {
  id: string;
  candidateCode: string;
  confidenceBand: "STRONG" | "MEDIUM" | "LOW";
  confidenceScore: number;
  matchingSignals: string;
  status: string;
  createdAt: string;
  profile: { id: string; profileCode: string; fullName: string };
  candidateProfile: { id: string; profileCode: string; fullName: string };
  reviewer: { name: string } | null;
}

const BAND_VARIANT: Record<string, "danger" | "warning" | "muted"> = { STRONG: "danger", MEDIUM: "warning", LOW: "muted" };

function CandidateRow({ candidate, onUpdated }: { candidate: DuplicateCandidateItem; onUpdated: () => void }) {
  const { show } = useToast();
  const [resolutionOpen, setResolutionOpen] = useState<"confirm" | "dismiss" | null>(null);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  const signals: string[] = (() => {
    try {
      return JSON.parse(candidate.matchingSignals);
    } catch {
      return [];
    }
  })();

  async function review() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/duplicates/${candidate.id}/review`, { method: "POST" });
      if (!res.ok) throw new Error();
      show("Marked as under review", "success");
      onUpdated();
    } catch {
      show("Could not start review.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(decision: "CONFIRMED_DUPLICATE" | "NOT_DUPLICATE") {
    if (!resolution.trim()) {
      show("A resolution note is required.", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/duplicates/${candidate.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, resolution: resolution.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error();
      if (json.approvalRequired) {
        show(`Submitted for approval (${json.approvalCode})`, "success");
      } else {
        show(decision === "CONFIRMED_DUPLICATE" ? "Confirmed as a duplicate" : "Dismissed — not a duplicate", "success");
      }
      setResolutionOpen(null);
      onUpdated();
    } catch {
      show("Could not resolve this candidate.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{candidate.candidateCode}</p>
        <div className="flex items-center gap-1.5">
          <Badge variant={BAND_VARIANT[candidate.confidenceBand]}>{formatEnumLabel(candidate.confidenceBand)} ({candidate.confidenceScore})</Badge>
          <StatusBadge status={candidate.status} />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Link href={`/admin/profiles/${candidate.profile.id}`} className="font-medium text-primary hover:underline">
          {candidate.profile.fullName} ({candidate.profile.profileCode})
        </Link>
        <span className="text-muted">↔</span>
        <Link href={`/admin/profiles/${candidate.candidateProfile.id}`} className="font-medium text-primary hover:underline">
          {candidate.candidateProfile.fullName} ({candidate.candidateProfile.profileCode})
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted">Matching signals: {signals.map((s) => formatEnumLabel(s)).join(", ")}</p>
      <p className="mt-1 text-xs text-muted">
        {formatDateTime(candidate.createdAt)} {candidate.reviewer ? `· Reviewed by ${candidate.reviewer.name}` : ""}
      </p>

      {candidate.status === "POTENTIAL_DUPLICATE" && (
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={review} disabled={busy}>
            Start Review
          </Button>
        </div>
      )}

      {(candidate.status === "DUPLICATE_REVIEW_REQUIRED" || candidate.status === "POTENTIAL_DUPLICATE") && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setResolutionOpen("confirm")} disabled={busy}>
            Confirm Duplicate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResolutionOpen("dismiss")} disabled={busy}>
            Not a Duplicate
          </Button>
        </div>
      )}

      {resolutionOpen && (
        <div className="mt-2 space-y-2">
          <Textarea rows={2} placeholder="Resolution notes (required)" value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => resolve(resolutionOpen === "confirm" ? "CONFIRMED_DUPLICATE" : "NOT_DUPLICATE")} disabled={busy}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setResolutionOpen(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DuplicateDetectionPage() {
  const [items, setItems] = useState<DuplicateCandidateItem[] | null>(null);
  const [tab, setTab] = useState("open");
  const { show } = useToast();
  const [scanning, setScanning] = useState(false);

  function load() {
    const params = new URLSearchParams();
    if (tab === "open") {
      // client-side filter below — the API returns everything for a status filter of one value at a time
    } else if (tab !== "all") {
      params.set("status", tab);
    }
    fetch(`/api/admin/duplicates?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => setItems(json.items ?? []));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const visible = items?.filter((i) => (tab === "open" ? i.status === "POTENTIAL_DUPLICATE" || i.status === "DUPLICATE_REVIEW_REQUIRED" : true)) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Duplicate Detection</h1>
          <p className="text-sm text-muted">
            Potential duplicate profiles found by the duplicate scan, with weighted evidence. No account is ever automatically merged, deleted, or
            suspended — every confirmation is a human decision.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={scanning}
          onClick={async () => {
            setScanning(true);
            try {
              const res = await fetch("/api/admin/verification/duplicate-scan", { method: "POST" });
              const json = await res.json();
              if (!res.ok) throw new Error();
              show(`Scan complete — ${json.flagsCreated} new candidate(s) found across ${json.profilesScanned} profiles.`, "success");
              load();
            } catch {
              show("Could not run the duplicate scan.", "error");
            } finally {
              setScanning(false);
            }
          }}
        >
          {scanning && <Loader2 className="h-4 w-4 animate-spin" />} Run Duplicate Scan
        </Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "open", label: "Open" },
          { value: "CONFIRMED_DUPLICATE", label: "Confirmed" },
          { value: "NOT_DUPLICATE", label: "Dismissed" },
          { value: "all", label: "All" },
        ]}
      />

      <Card>
        <CardContent>
          {visible === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={Copy} title="No potential duplicates here" />
          ) : (
            <div className="space-y-2">
              {visible.map((c) => (
                <CandidateRow key={c.id} candidate={c} onUpdated={load} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
