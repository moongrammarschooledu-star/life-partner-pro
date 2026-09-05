"use client";

import { useEffect, useState } from "react";
import { Loader2, MessageSquare, RefreshCw, Webhook } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, Checkbox } from "@/components/ui/form";
import { BarChart } from "@/components/admin/bar-chart";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface LogItem {
  id: string;
  profile: { id: string; profileCode: string; fullName: string };
  proposal: { id: string; proposalCode: string | null } | null;
  channel: string;
  notificationType: string;
  deliveryStatus: string;
  recipientReference: string | null;
  messageBody: string | null;
  isTest: boolean;
  retryCount: number;
  failureReason: string | null;
  createdBy: { id: string; name: string } | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  providerMessageId: string | null;
}

interface Analytics {
  total: number;
  byChannel: Record<string, number>;
  byStatus: Record<string, number>;
  deliveryRate: number | null;
  failureRate: number | null;
  volumeByDay: { label: string; count: number }[];
}

function LogRow({ log, onChanged }: { log: LogItem; onChanged: () => void }) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/communication-center/${log.id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error();
      show("Retry sent", "success");
      onChanged();
    } catch {
      show("Could not retry.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function simulate(eventType: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/webhooks/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationLogId: log.id, eventType }),
      });
      if (!res.ok) throw new Error();
      show(`Simulated ${eventType}`, "success");
      onChanged();
    } catch {
      show("Could not simulate webhook.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{log.profile.fullName}</span>
          <span className="ml-1 text-xs text-muted">({log.profile.profileCode})</span>
          {log.isTest && <Badge variant="warning" className="ml-2">Test</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="muted">{formatEnumLabel(log.channel)}</Badge>
          <StatusBadge status={log.deliveryStatus} />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">{formatEnumLabel(log.notificationType)}</p>
      {log.recipientReference && <p className="text-xs text-muted">To: {log.recipientReference}</p>}
      {log.messageBody !== null && <p className="mt-1 text-xs">{log.messageBody}</p>}
      {log.failureReason && <p className="mt-1 text-xs text-danger">Failed: {log.failureReason}</p>}
      <p className="mt-1 text-xs text-muted">
        {formatDateTime(log.createdAt)}
        {log.proposal?.proposalCode ? ` · ${log.proposal.proposalCode}` : ""}
        {log.createdBy ? ` · Sent by ${log.createdBy.name}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {log.deliveryStatus === "FAILED" && (
          <Button size="sm" variant="outline" onClick={retry} disabled={busy}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        )}
        {log.providerMessageId && log.channel !== "IN_APP" && (
          <>
            <Button size="sm" variant="ghost" onClick={() => simulate("DELIVERED")} disabled={busy}>
              <Webhook className="h-3.5 w-3.5" /> Simulate Delivered
            </Button>
            <Button size="sm" variant="ghost" onClick={() => simulate("FAILED")} disabled={busy}>
              Simulate Failed
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function TestModeCard() {
  const { show } = useToast();
  const [channel, setChannel] = useState("EMAIL");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("This is a test notification from Life Partner Pro.");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await fetch("/api/admin/test/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, to, message }),
      });
      if (!res.ok) throw new Error();
      show("Test notification sent", "success");
    } catch {
      show("Test send failed.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Test Mode</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">
          Sends are clearly marked as test and never reach a real applicant — type in your own email/phone below.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Channel" htmlFor="testChannel">
            <Select id="testChannel" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="IN_APP">In-App</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
          </Field>
          {channel !== "IN_APP" && (
            <Field label="Destination" htmlFor="testTo">
              <Input id="testTo" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com or +92..." />
            </Field>
          )}
        </div>
        <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        <Button size="sm" onClick={send} disabled={sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Test"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function CommunicationCenterPage() {
  const [logs, setLogs] = useState<LogItem[] | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [filters, setFilters] = useState({ profileCode: "", proposalCode: "", channel: "", status: "", includeTest: false });

  function load() {
    const params = new URLSearchParams();
    if (filters.profileCode) params.set("profileCode", filters.profileCode);
    if (filters.proposalCode) params.set("proposalCode", filters.proposalCode);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.status) params.set("status", filters.status);
    if (filters.includeTest) params.set("includeTest", "true");
    fetch(`/api/admin/communication-center?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => setLogs(json.items ?? []));
  }

  function loadAnalytics() {
    fetch("/api/admin/communication-center/analytics")
      .then((r) => r.json())
      .then(setAnalytics);
  }

  useEffect(() => {
    load();
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Communication Center</h1>
        <p className="text-sm text-muted">Search automated notification history, review delivery status, and manage test sends.</p>
      </div>

      {analytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Communication Analytics (last 30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-2xl font-semibold">{analytics.total}</p>
                <p className="text-xs text-muted">Total Notifications</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">{analytics.deliveryRate ?? "—"}%</p>
                <p className="text-xs text-muted">Delivery Rate</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">{analytics.failureRate ?? "—"}%</p>
                <p className="text-xs text-muted">Failure Rate</p>
              </div>
              <div>
                <p className="text-2xl font-semibold">{analytics.byChannel.EMAIL ?? 0}</p>
                <p className="text-xs text-muted">Email Sent</p>
              </div>
            </div>
            <div className="mt-4">
              <BarChart title="Volume by Channel" data={Object.entries(analytics.byChannel).map(([label, count]) => ({ label: formatEnumLabel(label), count }))} />
            </div>
          </CardContent>
        </Card>
      )}

      <TestModeCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          <Field label="Profile ID" htmlFor="profileCode">
            <Input id="profileCode" value={filters.profileCode} onChange={(e) => setFilters({ ...filters, profileCode: e.target.value })} placeholder="LPP-000001" />
          </Field>
          <Field label="Proposal ID" htmlFor="proposalCode">
            <Input id="proposalCode" value={filters.proposalCode} onChange={(e) => setFilters({ ...filters, proposalCode: e.target.value })} />
          </Field>
          <Field label="Channel" htmlFor="channel">
            <Select id="channel" value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
              <option value="">Any</option>
              <option value="IN_APP">In-App</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </Select>
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any</option>
              <option value="QUEUED">Queued</option>
              <option value="SENT">Sent</option>
              <option value="DELIVERED">Delivered</option>
              <option value="READ">Read</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
          <div className="flex items-end gap-3">
            <Checkbox label="Include test" checked={filters.includeTest} onChange={(e) => setFilters({ ...filters, includeTest: e.target.checked })} />
            <Button size="sm" onClick={load}>Search</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {logs === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No communication history yet" />
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <LogRow key={log.id} log={log} onChanged={load} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
