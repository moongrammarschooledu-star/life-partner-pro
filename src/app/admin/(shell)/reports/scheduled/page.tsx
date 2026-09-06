"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import { buttonClass, Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";

interface ScheduledReportRow {
  id: string;
  name: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  exportType: string;
  recipientAdminIds: string[];
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdBy: { name: string };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Table labels this column "(UTC)" — toLocaleString() would silently render
// in the viewer's local timezone instead, so format in UTC explicitly.
function formatUtc(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Spec §25 — Super Admin only.
export default function ScheduledReportsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<ScheduledReportRow[] | null>(null);
  const [admins, setAdmins] = useState<{ id: string; name: string }[]>([]);
  const [running, setRunning] = useState(false);

  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hourUtc, setHourUtc] = useState(9);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  function load() {
    fetch("/api/admin/reports/scheduled").then((r) => r.json()).then((j) => setItems(j.items));
  }

  useEffect(() => {
    load();
    fetch("/api/admin/reports/admins").then((r) => r.json()).then((j) => setAdmins(j.items ?? [])).catch(() => {});
  }, []);

  async function create() {
    if (!name.trim() || recipients.length === 0) {
      show("A name and at least one recipient are required.", "error");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/reports/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          reportKey: "overview",
          frequency,
          dayOfWeek: frequency === "WEEKLY" ? dayOfWeek : undefined,
          dayOfMonth: frequency === "MONTHLY" ? dayOfMonth : undefined,
          hourUtc,
          recipientAdminIds: recipients,
        }),
      });
      if (!res.ok) throw new Error();
      show("Scheduled report created.", "success");
      setName("");
      setRecipients([]);
      load();
    } catch {
      show("Could not create the scheduled report.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(id: string, active: boolean) {
    await fetch(`/api/admin/reports/scheduled/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    load();
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/reports/scheduled/run-now", { method: "POST" });
      const json = await res.json();
      show(`Ran ${json.ran ?? 0} due scheduled report(s).`, "success");
      load();
    } catch {
      show("Could not run scheduled reports.", "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/reports" className={buttonClass({ variant: "outline", size: "sm" })}>
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <div>
            <h1 className="font-heading text-2xl font-semibold">Scheduled Reports</h1>
            <p className="text-sm text-muted">Daily, weekly, or monthly summaries sent to authorized administrators only.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={runNow} disabled={running}>
          <Play className="h-3.5 w-3.5" /> Run Due Reports Now
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-4 text-sm font-medium">Create Scheduled Report</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Summary" />
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </Select>
          </Field>
          {frequency === "WEEKLY" && (
            <Field label="Day of Week">
              <Select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </Select>
            </Field>
          )}
          {frequency === "MONTHLY" && (
            <Field label="Day of Month">
              <Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} />
            </Field>
          )}
          <Field label="Hour (UTC, 0-23)">
            <Input type="number" min={0} max={23} value={hourUtc} onChange={(e) => setHourUtc(Number(e.target.value))} />
          </Field>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Recipients</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {admins.map((a) => (
              <Checkbox
                key={a.id}
                label={a.name}
                checked={recipients.includes(a.id)}
                onChange={(e) => setRecipients((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)))}
              />
            ))}
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={create} disabled={creating}>Create Scheduled Report</Button>
        </div>
      </div>

      {!items ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="No scheduled reports yet" />
      ) : (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Frequency</th>
                  <th className="pb-2">Next Run (UTC)</th>
                  <th className="pb-2">Last Run (UTC)</th>
                  <th className="pb-2">Recipients</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-2">{r.name}</td>
                    <td className="py-2 text-muted">{r.frequency}</td>
                    <td className="py-2 text-muted">{formatUtc(r.nextRunAt)}</td>
                    <td className="py-2 text-muted">{r.lastRunAt ? formatUtc(r.lastRunAt) : "Never"}</td>
                    <td className="py-2 text-muted">{r.recipientAdminIds.length}</td>
                    <td className="py-2">{r.active ? "Active" : "Disabled"}</td>
                    <td className="py-2 text-right">
                      <Button variant="outline" size="sm" onClick={() => toggleActive(r.id, !r.active)}>
                        {r.active ? "Disable" : "Enable"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
