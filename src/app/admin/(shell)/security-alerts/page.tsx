"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

interface Alert {
  id: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  occurredAt: string;
}

const SEVERITY_VARIANT: Record<Alert["severity"], "muted" | "warning" | "danger"> = {
  LOW: "muted",
  MEDIUM: "warning",
  HIGH: "danger",
  CRITICAL: "danger",
};

// Spec §33 — Super Admin only, computed fresh on each load (no persisted
// alert table — see src/lib/security-alerts.ts).
export default function SecurityAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/security-alerts")
      .then((r) => r.json())
      .then((data) => setAlerts(data.items ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Security Alerts</h1>
        <p className="text-sm text-muted">Repeated failed logins, large exports, and permission changes from the last 7 days.</p>
      </div>

      {alerts === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No security alerts" description="Nothing unusual in the last 7 days." />
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <Card key={a.id} className="flex items-start justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{a.title}</p>
                <p className="text-sm text-muted">{a.description}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(a.occurredAt)}</p>
              </div>
              <Badge variant={SEVERITY_VARIANT[a.severity]}>{a.severity}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
