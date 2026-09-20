"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { EnvironmentPanel, FlagsPanel, MaintenancePanel, EmergencyPanel, MonitoringPanel, BackupPolicyPanel, DeploymentPanel } from "@/components/admin/system/config-panels";

const TABS = [
  { value: "environment", label: "Environment" },
  { value: "flags", label: "Feature Flags" },
  { value: "maintenance", label: "Maintenance & State" },
  { value: "emergency", label: "Emergency Switches" },
  { value: "monitoring", label: "Monitoring & Security" },
  { value: "backup", label: "Backup Policy" },
  { value: "deployment", label: "Deployment" },
];

export function SystemConfigClient({ permissions }: { permissions: string[] }) {
  const [tab, setTab] = useState("environment");
  const can = (p: string) => permissions.includes(p);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">System Configuration</h1>
        <p className="text-sm text-muted">Operational controls for this deployment. Every change is permission-checked on the server, and high-risk ones need a reason and password re-confirmation; all are audited. Secret values are never shown.</p>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "environment" && <EnvironmentPanel />}
      {tab === "flags" && <FlagsPanel canManage={can("system:flags:manage")} />}
      {tab === "maintenance" && <MaintenancePanel canManage={can("system:maintenance:manage")} />}
      {tab === "emergency" && <EmergencyPanel canManage={can("system:emergency:manage")} />}
      {tab === "monitoring" && <MonitoringPanel canManage={can("system:config:manage")} />}
      {tab === "backup" && <BackupPolicyPanel canManage={can("system:config:manage")} />}
      {tab === "deployment" && <DeploymentPanel />}
    </div>
  );
}
