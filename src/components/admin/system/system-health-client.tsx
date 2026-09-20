"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { HealthOverview } from "@/components/admin/system/health-overview";
import { ErrorsPanel } from "@/components/admin/system/errors-panel";
import { PerformancePanel } from "@/components/admin/system/performance-panel";
import { BackupPanel } from "@/components/admin/system/backup-panel";
import { JobsPanel } from "@/components/admin/system/jobs-panel";
import { IntegrityPanel } from "@/components/admin/system/integrity-panel";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "errors", label: "Errors" },
  { value: "performance", label: "Performance & Slow Queries" },
  { value: "backup", label: "Backup & Recovery" },
  { value: "jobs", label: "Jobs & Cron" },
  { value: "integrity", label: "Data Integrity" },
];

export function SystemHealthClient({ permissions, adminId }: { permissions: string[]; adminId: string }) {
  const [tab, setTab] = useState("overview");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">System Health</h1>
        <p className="text-sm text-muted">Live status of the application, database, storage, payments, communications, jobs, backups and security. No secrets are ever shown here.</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "overview" && <HealthOverview />}
      {tab === "errors" && <ErrorsPanel />}
      {tab === "performance" && <PerformancePanel />}
      {tab === "backup" && <BackupPanel canTrigger={permissions.includes("system:backup:trigger")} canRestore={permissions.includes("system:restore:approve")} adminId={adminId} />}
      {tab === "jobs" && <JobsPanel canManage={permissions.includes("system:jobs:manage")} />}
      {tab === "integrity" && <IntegrityPanel canRun={permissions.includes("system:jobs:manage")} />}
    </div>
  );
}
