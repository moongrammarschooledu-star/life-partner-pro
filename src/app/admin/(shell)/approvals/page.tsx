"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Gavel, ShieldAlert, Clock, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/admin/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatEnumLabel } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

interface ApprovalRow {
  id: string;
  approvalCode: string;
  actionType: string;
  status: string;
  riskLevel: string;
  priority: string;
  sourceType: string;
  sourceId: string;
  requestedAt: string;
  expiresAt: string | null;
  maker: { id: string; name: string } | null;
  assignedChecker: { id: string; name: string } | null;
}

const RISK_VARIANT: Record<string, "danger" | "warning" | "muted" | "success" | "info"> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "success",
};

const STATUS_VARIANT: Record<string, "danger" | "warning" | "muted" | "success" | "info"> = {
  DRAFT: "muted",
  SUBMITTED: "info",
  PENDING_REVIEW: "info",
  PENDING_APPROVAL: "warning",
  PARTIALLY_APPROVED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CHANGES_REQUESTED: "warning",
  EXPIRED: "danger",
  CANCELLED: "muted",
  EXECUTION_PENDING: "info",
  EXECUTING: "info",
  EXECUTED: "success",
  EXECUTION_FAILED: "danger",
  REOPENED: "warning",
  ARCHIVED: "muted",
};

const TABS = [
  { value: "my-requests", label: "My Requests" },
  { value: "pending-my-approval", label: "Pending My Approval" },
  { value: "pending-review", label: "Pending Review" },
  { value: "high-risk", label: "High Risk" },
  { value: "critical", label: "Critical" },
  { value: "expiring-soon", label: "Expiring Soon" },
  { value: "rejected", label: "Rejected" },
  { value: "changes-requested", label: "Changes Requested" },
  { value: "executed", label: "Executed" },
  { value: "failed", label: "Failed" },
  { value: "archived", label: "Archived" },
];

export default function ApprovalsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [tab, setTab] = useState("my-requests");
  const [items, setItems] = useState<ApprovalRow[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [actionType, setActionType] = useState("");

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setPermissions(s?.user?.permissions ?? []))
      .catch(() => setPermissions([]));
  }, []);

  const visibleTabs = useMemo(() => {
    const canDecide = ["approvals:approve", "finance:approval:approve", "privacy:approval:approve", "security:approval:approve", "ai:approval:approve", "sensitive:approval:approve"].some((p) =>
      permissions.includes(p as Permission)
    );
    return canDecide ? TABS : TABS.filter((t) => t.value !== "pending-my-approval");
  }, [permissions]);

  function loadItems() {
    setItems(null);
    const params = new URLSearchParams({ tab });
    if (search.trim()) params.set("search", search.trim());
    if (actionType) params.set("actionType", actionType);
    fetch(`/api/admin/approvals?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]));
  }

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const kpis = useMemo(() => {
    if (!items) return null;
    return {
      total: items.length,
      critical: items.filter((i) => i.riskLevel === "CRITICAL").length,
      high: items.filter((i) => i.riskLevel === "HIGH").length,
      pending: items.filter((i) => ["SUBMITTED", "PENDING_REVIEW", "PENDING_APPROVAL", "PARTIALLY_APPROVED"].includes(i.status)).length,
    };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Approvals</h1>
          <p className="text-sm text-muted">Maker-checker governance for high-risk administrative actions — every decision independently reviewed and audited.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm font-medium">
          {permissions.includes("approvals:policy:manage") && (
            <Link href="/admin/approvals/policies" className="text-primary hover:underline">Governance Policies</Link>
          )}
          {permissions.includes("approvals:emergency-override") && (
            <Link href="/admin/approvals/emergency-override" className="text-danger hover:underline">Emergency Override</Link>
          )}
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Gavel} label="In This View" value={kpis.total} />
          <StatCard icon={Clock} label="Pending Decision" value={kpis.pending} accent={kpis.pending > 0 ? "warning" : "success"} />
          <StatCard icon={ShieldAlert} label="High Risk" value={kpis.high} accent="warning" />
          <StatCard icon={ShieldAlert} label="Critical" value={kpis.critical} accent={kpis.critical > 0 ? "danger" : "muted"} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={visibleTabs} value={tab} onChange={setTab} />
        <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
          <Filter className="h-4 w-4" /> Filters
        </Button>
      </div>

      <Input placeholder="Search by approval code…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadItems()} className="max-w-md" />

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
          <Field label="Action Type" htmlFor="f-action-type">
            <Input id="f-action-type" placeholder="e.g. PROFILE_RESTRICT" value={actionType} onChange={(e) => setActionType(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadItems()} />
          </Field>
        </div>
      )}

      {items === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Gavel} title="No approval requests found" description="Try a different tab or adjust your filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Approval</th>
                <th className="p-3">Action</th>
                <th className="p-3">Risk</th>
                <th className="p-3">Status</th>
                <th className="p-3">Maker</th>
                <th className="p-3">Expires</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{a.approvalCode}</td>
                  <td className="p-3 text-muted">{formatEnumLabel(a.actionType)}</td>
                  <td className="p-3">
                    <Badge variant={RISK_VARIANT[a.riskLevel] ?? "muted"}>{formatEnumLabel(a.riskLevel)}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_VARIANT[a.status] ?? "muted"}>{formatEnumLabel(a.status)}</Badge>
                  </td>
                  <td className="p-3 text-muted">{a.maker?.name ?? "—"}</td>
                  <td className="p-3 text-muted">{a.expiresAt ? formatDate(a.expiresAt) : "—"}</td>
                  <td className="p-3">
                    <Link href={`/admin/approvals/${a.id}`} className="font-medium text-primary hover:underline">
                      View
                    </Link>
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
