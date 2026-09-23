"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";
import { TASK_PRIORITIES } from "@/lib/workflow/task-types";

interface Rule {
  id: string;
  eventName: string;
  taskType: string;
  defaultPriority: string;
  defaultAssignedRole: string | null;
  active: boolean;
}

const ROLES = [
  "SUPER_ADMIN", "OPERATIONS_ADMIN", "MATCHMAKING_MANAGER", "VERIFICATION_MANAGER", "SUPPORT_MANAGER",
  "COMMUNICATION_MANAGER", "FINANCE_MANAGER", "STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF",
  "COMMUNICATION_STAFF", "REPORTING_ANALYST", "VIEWER",
];

// STEP 18 §19 — Admin → Workflow Automation. Shows exactly which system
// event creates which task type by default, and lets an admin adjust the
// default priority/assignee or disable a rule entirely.
export default function AutomationRulesPage() {
  const { show } = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);

  function load() {
    fetch("/api/admin/tasks/automation-rules")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setRules(data.items ?? []))
      .catch(() => setRules([]));
  }

  useEffect(load, []);

  async function update(rule: Rule, patch: Partial<Rule>) {
    setRules((prev) => prev?.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)) ?? null);
    const res = await fetch(`/api/admin/tasks/automation-rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) {
      const json = await res.json();
      show(json.error ?? "Could not update rule.", "error");
      load();
      return;
    }
    show("Updated", "success");
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/workflow" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Workflow &amp; Tasks
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">Workflow Automation</h1>
        <p className="text-sm text-muted">Which system event automatically creates which task, and for whom by default.</p>
      </div>

      {rules === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Event</th>
                <th className="p-3">Creates Task Type</th>
                <th className="p-3">Default Priority</th>
                <th className="p-3">Default Role</th>
                <th className="p-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{rule.eventName}</td>
                  <td className="p-3">
                    <Badge variant="muted">{formatEnumLabel(rule.taskType)}</Badge>
                  </td>
                  <td className="p-3">
                    <Select className="h-8 w-auto text-xs" value={rule.defaultPriority} onChange={(e) => update(rule, { defaultPriority: e.target.value })}>
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>{formatEnumLabel(p)}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="p-3">
                    <Select className="h-8 w-auto text-xs" value={rule.defaultAssignedRole ?? ""} onChange={(e) => update(rule, { defaultAssignedRole: e.target.value || null })}>
                      <option value="">None</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{formatEnumLabel(r)}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="p-3">
                    <Checkbox label="" checked={rule.active} onChange={(e) => update(rule, { active: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
