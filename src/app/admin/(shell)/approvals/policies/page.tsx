"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";

interface PolicyRow {
  id: string;
  actionType: string;
  enabled: boolean;
  riskLevel: string;
  requiredLevel: string;
  minimumApprovers: number;
  quorum: number;
  reauthRequired: boolean;
  emergencyOverrideAllowed: boolean;
  expirationMinutes: number;
}

// STEP 19 §9 — Admin → Approvals → Governance Policies. Super-Admin-only
// (approvals:policy:manage). Every field here is genuinely admin-editable —
// the actual authorization decision at request time always reads this live
// row, never a hardcoded default.
export default function ApprovalPoliciesPage() {
  const { show } = useToast();
  const [rows, setRows] = useState<PolicyRow[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/approval-policies")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setRows(data.items ?? []))
      .catch(() => setRows([]));
  }

  useEffect(load, []);

  function updateRow(id: string, patch: Partial<PolicyRow>) {
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? null);
  }

  async function saveRow(row: PolicyRow) {
    setSavingId(row.id);
    try {
      const res = await fetch(`/api/admin/approval-policies/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: row.enabled,
          minimumApprovers: row.minimumApprovers,
          quorum: row.quorum,
          reauthRequired: row.reauthRequired,
          emergencyOverrideAllowed: row.emergencyOverrideAllowed,
          expirationMinutes: row.expirationMinutes,
          reason: "Updated via Governance Policies screen",
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not save.", "error");
        return;
      }
      show("Saved", "success");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/approvals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Approvals
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">Governance Policies</h1>
        <p className="text-sm text-muted">Which high-risk actions require approval, at what level, and by how many independent reviewers. Super Admin only.</p>
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
                <th className="p-3">Action</th>
                <th className="p-3">Risk</th>
                <th className="p-3">Level</th>
                <th className="p-3">Min Approvers</th>
                <th className="p-3">Quorum</th>
                <th className="p-3">Reauth</th>
                <th className="p-3">Emergency OK</th>
                <th className="p-3">Expires (min)</th>
                <th className="p-3">Enabled</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="p-3">{formatEnumLabel(row.actionType)}</td>
                  <td className="p-3 text-muted">{formatEnumLabel(row.riskLevel)}</td>
                  <td className="p-3 text-muted">{formatEnumLabel(row.requiredLevel)}</td>
                  <td className="p-3">
                    <Input type="number" className="h-8 w-16" value={row.minimumApprovers} onChange={(e) => updateRow(row.id, { minimumApprovers: Number(e.target.value) })} />
                  </td>
                  <td className="p-3">
                    <Input type="number" className="h-8 w-16" value={row.quorum} onChange={(e) => updateRow(row.id, { quorum: Number(e.target.value) })} />
                  </td>
                  <td className="p-3">
                    <Checkbox label="" checked={row.reauthRequired} onChange={(e) => updateRow(row.id, { reauthRequired: e.target.checked })} />
                  </td>
                  <td className="p-3">
                    <Checkbox label="" checked={row.emergencyOverrideAllowed} onChange={(e) => updateRow(row.id, { emergencyOverrideAllowed: e.target.checked })} />
                  </td>
                  <td className="p-3">
                    <Input type="number" className="h-8 w-24" value={row.expirationMinutes} onChange={(e) => updateRow(row.id, { expirationMinutes: Number(e.target.value) })} />
                  </td>
                  <td className="p-3">
                    <Checkbox label="" checked={row.enabled} onChange={(e) => updateRow(row.id, { enabled: e.target.checked })} />
                  </td>
                  <td className="p-3">
                    <Button size="sm" variant="outline" onClick={() => saveRow(row)} disabled={savingId === row.id}>
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
