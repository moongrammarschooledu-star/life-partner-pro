"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, LifeBuoy, Filter, Plus } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/admin/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NewCaseModal } from "@/components/admin/case-management/new-case-modal";
import { formatDate, formatEnumLabel } from "@/lib/utils";
import { Briefcase, FolderOpen, AlertTriangle, ArrowUpCircle } from "lucide-react";

interface CaseRow {
  id: string;
  caseNumber: string;
  type: string;
  category: string;
  subject: string;
  priority: string;
  status: string;
  reporterProfile: { fullName: string; profileCode: string } | null;
  reportedProfile: { fullName: string; profileCode: string } | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  escalationLevel: number;
}

interface Dashboard {
  totalCases: number;
  newCases: number;
  openCases: number;
  highPriority: number;
  urgentCritical: number;
  assignedToMe: number;
  waitingForUser: number;
  overdue: number;
  resolvedToday: number;
  escalatedCases: number;
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted" | "success"> = {
  CRITICAL: "danger", URGENT: "danger", HIGH: "warning", NORMAL: "muted", LOW: "success",
};

const SCOPES = [
  { value: "all", label: "All Cases" },
  { value: "mine", label: "My Cases" },
  { value: "new", label: "New" },
  { value: "overdue", label: "Overdue" },
  { value: "high", label: "High Priority" },
  { value: "escalated", label: "Escalated" },
  { value: "waiting", label: "Waiting for User" },
];

export default function CaseManagementPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [scope, setScope] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/case-management/dashboard")
      .then((r) => r.json())
      .then(setDashboard)
      .catch(() => {});
  }, []);

  function load() {
    setCases(null);
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (q) params.set("q", q);
    if (scope === "mine") params.set("scope", "mine");
    if (scope === "new") params.set("status", "NEW");
    if (scope === "escalated") params.set("status", "ESCALATED");
    if (scope === "waiting") params.set("status", "WAITING_FOR_USER");
    fetch(`/api/admin/cases?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setCases(data.items ?? []))
      .catch(() => setCases([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, type, status, priority]);

  const filtered = useMemo(() => {
    if (!cases) return [];
    if (scope === "overdue") {
      return cases.filter((c) => c.status !== "RESOLVED" && c.status !== "CLOSED" && c.status !== "ARCHIVED");
    }
    if (scope === "high") return cases.filter((c) => c.priority === "HIGH" || c.priority === "URGENT" || c.priority === "CRITICAL");
    return cases;
  }, [cases, scope]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Case Management</h1>
          <p className="text-sm text-muted">Support requests, complaints, and safety reports — private and role-controlled.</p>
        </div>
        <Button size="sm" onClick={() => setNewCaseOpen(true)}>
          <Plus className="h-4 w-4" /> New Case
        </Button>
      </div>

      <NewCaseModal open={newCaseOpen} onClose={() => { setNewCaseOpen(false); load(); }} />

      {dashboard && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Briefcase} label="Total Cases" value={dashboard.totalCases} />
          <StatCard icon={FolderOpen} label="Open Cases" value={dashboard.openCases} accent="info" />
          <StatCard icon={AlertTriangle} label="Overdue" value={dashboard.overdue} accent={dashboard.overdue > 0 ? "danger" : "success"} />
          <StatCard icon={ArrowUpCircle} label="Escalated" value={dashboard.escalatedCases} accent="warning" />
          <StatCard icon={LifeBuoy} label="Assigned to Me" value={dashboard.assignedToMe} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={SCOPES} value={scope} onChange={setScope} />
        <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
          <Filter className="h-4 w-4" /> Filters
        </Button>
      </div>

      <Input placeholder="Search by case number or subject…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} className="max-w-md" />

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
          <Field label="Type" htmlFor="f-type">
            <Select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any</option>
              <option value="SUPPORT">Support</option>
              <option value="COMPLAINT">Complaint</option>
              <option value="SAFETY_REPORT">Safety Report</option>
              <option value="INTERNAL">Internal</option>
            </Select>
          </Field>
          <Field label="Priority" htmlFor="f-priority">
            <Select id="f-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Any</option>
              {["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"].map((p) => (
                <option key={p} value={p}>{formatEnumLabel(p)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "ESCALATED", "ACTION_REQUIRED", "RESOLVED", "CLOSED", "REOPENED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>{formatEnumLabel(s)}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {cases === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No cases found" description="Try adjusting your filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Case</th>
                <th className="p-3">Type</th>
                <th className="p-3">Subject</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Status</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Created</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">
                    {c.caseNumber}
                    {c.escalationLevel > 1 && <Badge variant="danger">L{c.escalationLevel}</Badge>}
                  </td>
                  <td className="p-3 text-muted">{formatEnumLabel(c.type)}</td>
                  <td className="p-3">{c.subject}</td>
                  <td className="p-3">
                    <Badge variant={PRIORITY_VARIANT[c.priority]}>{formatEnumLabel(c.priority)}</Badge>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="p-3 text-muted">{c.assignedTo?.name ?? "Unassigned"}</td>
                  <td className="p-3 text-muted">{formatDate(c.createdAt)}</td>
                  <td className="p-3">
                    <Link href={`/admin/case-management/${c.id}`} className="font-medium text-primary hover:underline">
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
