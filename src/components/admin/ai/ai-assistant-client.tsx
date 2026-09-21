"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import {
  AnalyzeProfilePanel,
  CommunicationPanel,
  ComparePanel,
  CopilotPanel,
  DataQualityPanel,
  ExplainMatchPanel,
  FollowUpPanel,
  ProposalPanel,
  ReportPanel,
} from "@/components/admin/ai/ai-feature-panels";
import { ActivityPanel, HealthPanel, OverviewPanel, SafetyPanel, SettingsPanel, UsagePanel } from "@/components/admin/ai/ai-admin-panels";

interface TabDef { value: string; label: string; needs: string[] }

// Spec §3 — Admin → AI Matchmaking Assistant. A tab is shown only when the
// admin holds the permission the server will enforce for it.
const TAB_DEFS: TabDef[] = [
  { value: "overview", label: "AI Overview", needs: ["ai:view"] },
  { value: "analyze", label: "Analyze Profile", needs: ["ai:use"] },
  { value: "explain", label: "Explain Match", needs: ["ai:use", "match:run"] },
  { value: "compare", label: "Compare Candidates", needs: ["ai:use", "match:run"] },
  { value: "missing", label: "Find Missing Information", needs: ["ai:use"] },
  { value: "proposal", label: "Proposal Assistant", needs: ["ai:use", "match:run"] },
  { value: "followup", label: "Follow-up Assistant", needs: ["ai:communication:draft"] },
  { value: "communication", label: "Communication Assistant", needs: ["ai:communication:draft"] },
  { value: "improve", label: "Profile Improvement", needs: ["ai:use"] },
  { value: "copilot", label: "Copilot", needs: ["ai:copilot"] },
  { value: "reports", label: "Report Assistant", needs: ["ai:report:use", "reports:view"] },
  { value: "history", label: "AI History", needs: ["ai:activity:view"] },
  { value: "usage", label: "AI Usage & Cost", needs: ["ai:usage:view"] },
  { value: "health", label: "AI Health", needs: ["ai:view"] },
  { value: "settings", label: "AI Settings", needs: ["ai:config:manage", "ai:rollout:manage", "ai:killswitch", "ai:test:run"] },
  { value: "safety", label: "AI Safety", needs: ["ai:view"] },
];

export function AiAssistantClient({ permissions }: { permissions: string[] }) {
  const has = (p: string) => permissions.includes(p);
  const tabs = TAB_DEFS.filter((t) => (t.value === "settings" ? t.needs.some(has) : t.needs.every(has))).map((t) => ({ value: t.value, label: t.label }));
  const [tab, setTab] = useState(tabs[0]?.value ?? "overview");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">AI Matchmaking Assistant</h1>
        <p className="text-sm text-muted">An assistant for authorised matchmaking staff. It recommends and explains; you decide. It never approves, rejects, shares contact details, sends messages or changes a compatibility score.</p>
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "overview" && <OverviewPanel />}
      {tab === "analyze" && <AnalyzeProfilePanel />}
      {tab === "explain" && <ExplainMatchPanel />}
      {tab === "compare" && <ComparePanel />}
      {tab === "missing" && <DataQualityPanel mode="quality" />}
      {tab === "proposal" && <ProposalPanel />}
      {tab === "followup" && <FollowUpPanel />}
      {tab === "communication" && <CommunicationPanel />}
      {tab === "improve" && <DataQualityPanel mode="improvement" />}
      {tab === "copilot" && <CopilotPanel />}
      {tab === "reports" && <ReportPanel />}
      {tab === "history" && <ActivityPanel />}
      {tab === "usage" && <UsagePanel />}
      {tab === "health" && <HealthPanel />}
      {tab === "settings" && <SettingsPanel canConfig={has("ai:config:manage")} canRollout={has("ai:rollout:manage")} canKill={has("ai:killswitch")} canTest={has("ai:test:run")} />}
      {tab === "safety" && <SafetyPanel />}
    </div>
  );
}
