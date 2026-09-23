"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, ListChecks, ClipboardList, AlertTriangle, ArrowUpCircle, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/admin/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatEnumLabel } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

interface TaskRow {
  id: string;
  taskCode: string | null;
  taskType: string;
  title: string | null;
  resourceType: string;
  priority: string;
  status: string;
  dueAt: string | null;
  escalationLevel: number;
  escalationStatus: string;
  createdAt: string;
  assignedTo: { id: string; name: string } | null;
  assignedDepartment: { id: string; name: string } | null;
}

interface WorkQueueKpis {
  openTasks: number;
  dueToday: number;
  dueTomorrow: number;
  overdue: number;
  highPriority: number;
  critical: number;
  waitingForUser: number;
  waitingForApproval: number;
  recentlyCompleted: number;
  reopened: number;
  escalated: number;
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted" | "success" | "info"> = {
  CRITICAL: "danger",
  URGENT: "danger",
  HIGH: "warning",
  NORMAL: "muted",
  LOW: "success",
};

const STATUS_VARIANT: Record<string, "danger" | "warning" | "muted" | "success" | "info"> = {
  NEW: "info",
  ASSIGNED: "info",
  ACCEPTED: "info",
  IN_PROGRESS: "info",
  WAITING_FOR_USER: "warning",
  WAITING_FOR_STAFF: "warning",
  WAITING_FOR_APPROVAL: "warning",
  BLOCKED: "warning",
  ESCALATED: "danger",
  COMPLETED: "success",
  CANCELLED: "muted",
  EXPIRED: "danger",
  REOPENED: "warning",
  ARCHIVED: "muted",
  PENDING: "muted",
};

const STATUSES = ["NEW", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "WAITING_FOR_USER", "WAITING_FOR_STAFF", "WAITING_FOR_APPROVAL", "BLOCKED", "ESCALATED", "COMPLETED", "CANCELLED", "EXPIRED", "REOPENED", "ARCHIVED"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"];

export default function WorkflowPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [scope, setScope] = useState("own");
  const [kpis, setKpis] = useState<WorkQueueKpis | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setPermissions(s?.user?.permissions ?? []))
      .catch(() => setPermissions([]));
  }, []);

  const scopes = useMemo(() => {
    const list = [{ value: "own", label: "My Tasks" }];
    if (permissions.includes("tasks:view:team")) list.push({ value: "team", label: "Team Work Queue" });
    if (permissions.includes("tasks:view:all")) list.push({ value: "all", label: "All Work" });
    return list;
  }, [permissions]);

  function loadKpis() {
    fetch(`/api/admin/work-queue?scope=${scope}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setKpis)
      .catch(() => setKpis(null));
  }

  function loadTasks() {
    setTasks(null);
    const params = new URLSearchParams({ scope });
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (search.trim()) params.set("search", search.trim());
    if (overdueOnly) params.set("overdue", "true");
    fetch(`/api/admin/tasks?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data) => setTasks(data.items ?? []))
      .catch(() => setTasks([]));
  }

  useEffect(() => {
    loadKpis();
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, status, priority, overdueOnly]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Workflow &amp; Tasks</h1>
          <p className="text-sm text-muted">Every operational action tracked as an assigned, permission-governed, auditable task.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm font-medium">
          {permissions.includes("tasks:templates:manage") && (
            <Link href="/admin/workflow/templates" className="text-primary hover:underline">Templates</Link>
          )}
          {permissions.includes("tasks:sla:manage") && (
            <Link href="/admin/workflow/sla-config" className="text-primary hover:underline">SLA Config</Link>
          )}
          {permissions.includes("tasks:automation:manage") && (
            <Link href="/admin/workflow/automation-rules" className="text-primary hover:underline">Automation</Link>
          )}
          {permissions.includes("staff:availability:manage") && (
            <Link href="/admin/workflow/staff-availability" className="text-primary hover:underline">Staff Availability</Link>
          )}
          {permissions.includes("tasks:workflow-failures:view") && (
            <Link href="/admin/workflow/failures" className="text-primary hover:underline">Workflow Failures</Link>
          )}
        </div>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard icon={ClipboardList} label="Open Tasks" value={kpis.openTasks} />
          <StatCard icon={AlertTriangle} label="Overdue" value={kpis.overdue} accent={kpis.overdue > 0 ? "danger" : "success"} />
          <StatCard icon={ArrowUpCircle} label="Escalated" value={kpis.escalated} accent="warning" />
          <StatCard icon={ListChecks} label="Due Today" value={kpis.dueToday} accent="info" />
          <StatCard icon={ListChecks} label="Critical" value={kpis.critical} accent={kpis.critical > 0 ? "danger" : "muted"} />
          <StatCard icon={ListChecks} label="Completed (7d)" value={kpis.recentlyCompleted} accent="success" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={scopes} value={scope} onChange={setScope} />
        <div className="flex items-center gap-2">
          <Button size="sm" variant={overdueOnly ? "primary" : "outline"} onClick={() => setOverdueOnly((v) => !v)}>
            Overdue only
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
            <Filter className="h-4 w-4" /> Filters
          </Button>
        </div>
      </div>

      <Input placeholder="Search by task code…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadTasks()} className="max-w-md" />

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {formatEnumLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="f-priority">
            <Select id="f-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">Any</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {formatEnumLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {tasks === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks found" description="Try adjusting your filters." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Task</th>
                <th className="p-3">Type</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Status</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Due</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">
                    {t.taskCode ?? t.id}
                    {t.escalationLevel > 1 && <Badge variant="danger">L{t.escalationLevel}</Badge>}
                    {t.title && <span className="mt-0.5 block font-sans text-sm font-normal text-foreground">{t.title}</span>}
                  </td>
                  <td className="p-3 text-muted">{formatEnumLabel(t.taskType)}</td>
                  <td className="p-3">
                    <Badge variant={PRIORITY_VARIANT[t.priority] ?? "muted"}>{formatEnumLabel(t.priority)}</Badge>
                  </td>
                  <td className="p-3">
                    <Badge variant={STATUS_VARIANT[t.status] ?? "muted"}>{formatEnumLabel(t.status)}</Badge>
                  </td>
                  <td className="p-3 text-muted">{t.assignedTo?.name ?? "Unassigned"}</td>
                  <td className="p-3 text-muted">{t.dueAt ? formatDate(t.dueAt) : "—"}</td>
                  <td className="p-3">
                    <Link href={`/admin/workflow/${t.id}`} className="font-medium text-primary hover:underline">
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
