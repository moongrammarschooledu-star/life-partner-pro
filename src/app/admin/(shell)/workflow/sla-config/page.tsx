"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface SlaRow {
  id: string | null;
  taskType: string;
  targetResponseHours: number | null;
  targetResolutionHours: number | null;
  warningThresholdHours: number | null;
  active: boolean;
}

// STEP 18 §20 — Admin → SLA Configuration. Genuinely admin-configurable per
// task type, not hardcoded.
export default function SlaConfigPage() {
  const { show } = useToast();
  const [rows, setRows] = useState<SlaRow[] | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/tasks/sla-config")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setRows(data.items ?? []))
      .catch(() => setRows([]));
  }

  useEffect(load, []);

  function updateRow(taskType: string, patch: Partial<SlaRow>) {
    setRows((prev) => prev?.map((r) => (r.taskType === taskType ? { ...r, ...patch } : r)) ?? null);
  }

  async function saveRow(row: SlaRow) {
    setSavingType(row.taskType);
    try {
      const res = await fetch("/api/admin/tasks/sla-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: row.taskType,
          targetResponseHours: row.targetResponseHours,
          targetResolutionHours: row.targetResolutionHours,
          warningThresholdHours: row.warningThresholdHours,
          active: row.active,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not save.", "error");
        return;
      }
      show("Saved", "success");
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/workflow" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Workflow &amp; Tasks
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">SLA Configuration</h1>
        <p className="text-sm text-muted">Target response/resolution hours per task type. A type with no active SLA never blocks or auto-escalates.</p>
      </div>

      {rows === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Task Type</th>
                <th className="p-3">Response (h)</th>
                <th className="p-3">Resolution (h)</th>
                <th className="p-3">Warning (h)</th>
                <th className="p-3">Active</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.taskType} className="border-b border-border last:border-0">
                  <td className="p-3">{formatEnumLabel(row.taskType)}</td>
                  <td className="p-3">
                    <Input type="number" className="h-8 w-20" value={row.targetResponseHours ?? ""} onChange={(e) => updateRow(row.taskType, { targetResponseHours: e.target.value ? Number(e.target.value) : null })} />
                  </td>
                  <td className="p-3">
                    <Input type="number" className="h-8 w-20" value={row.targetResolutionHours ?? ""} onChange={(e) => updateRow(row.taskType, { targetResolutionHours: e.target.value ? Number(e.target.value) : null })} />
                  </td>
                  <td className="p-3">
                    <Input type="number" className="h-8 w-20" value={row.warningThresholdHours ?? ""} onChange={(e) => updateRow(row.taskType, { warningThresholdHours: e.target.value ? Number(e.target.value) : null })} />
                  </td>
                  <td className="p-3">
                    <Checkbox label="" checked={row.active} onChange={(e) => updateRow(row.taskType, { active: e.target.checked })} />
                  </td>
                  <td className="p-3">
                    <Button size="sm" variant="outline" onClick={() => saveRow(row)} disabled={savingType === row.taskType}>
                      Save
                    </Button>
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
