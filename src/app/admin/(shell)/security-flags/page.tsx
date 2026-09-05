"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Flag } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface FlagItem {
  id: string;
  flagType: string;
  severity: string;
  status: string;
  description: string;
  createdAt: string;
  profile: { id: string; profileCode: string; fullName: string };
  relatedProfile: { id: string; profileCode: string; fullName: string } | null;
  assignedTo: { name: string } | null;
}

const SEVERITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

function FlagRow({ flag, onResolved }: { flag: FlagItem; onResolved: () => void }) {
  const { show } = useToast();
  const [showResolve, setShowResolve] = useState(false);
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  async function updateStatus(status: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/security-flags/${flag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolution: status === "RESOLVED" || status === "DISMISSED" ? resolution : undefined }),
      });
      if (!res.ok) throw new Error();
      show("Flag updated", "success");
      setShowResolve(false);
      onResolved();
    } catch {
      show("Could not update flag.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/admin/verification/${flag.profile.id}`} className="font-medium text-primary hover:underline">
            {flag.profile.fullName}
          </Link>
          <span className="ml-1 text-xs text-muted">({flag.profile.profileCode})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant={SEVERITY_VARIANT[flag.severity]}>{formatEnumLabel(flag.severity)}</Badge>
          <StatusBadge status={flag.status} />
        </div>
      </div>
      <p className="mt-1 font-medium">{formatEnumLabel(flag.flagType)}</p>
      <p className="text-xs text-muted">{flag.description}</p>
      {flag.relatedProfile && (
        <Link href={`/admin/profiles/${flag.relatedProfile.id}`} className="text-xs text-primary hover:underline">
          Related: {flag.relatedProfile.fullName} ({flag.relatedProfile.profileCode})
        </Link>
      )}
      <p className="mt-1 text-xs text-muted">
        {formatDateTime(flag.createdAt)} {flag.assignedTo ? `· Assigned to ${flag.assignedTo.name}` : ""}
      </p>
      {flag.status !== "RESOLVED" && flag.status !== "DISMISSED" && (
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

export default function SecurityFlagsPage() {
  const [flags, setFlags] = useState<FlagItem[] | null>(null);
  const [tab, setTab] = useState("open");

  function load() {
    const status = tab === "all" ? "" : tab === "open" ? "" : tab.toUpperCase();
    const params = new URLSearchParams();
    if (tab === "open") params.set("status", "OPEN");
    else if (tab !== "all") params.set("status", status);
    fetch(`/api/admin/security-flags?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => setFlags(json.items ?? []));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Security Flags</h1>
        <p className="text-sm text-muted">Multiple registrations, duplicate suspicion, verification inconsistencies, and abuse reports — reviewed and resolved here.</p>
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
          {flags === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : flags.length === 0 ? (
            <EmptyState icon={Flag} title="No flags here" />
          ) : (
            <div className="space-y-2">
              {flags.map((f) => (
                <FlagRow key={f.id} flag={f} onResolved={load} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
