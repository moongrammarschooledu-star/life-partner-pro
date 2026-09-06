"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Monitor } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

interface SessionRow {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  createdAt: string;
  revoked: boolean;
  isCurrent: boolean;
}

interface LoginHistoryRow {
  id: string;
  event: "SUCCESS" | "FAILURE" | "LOCKED";
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// Spec §13/§14 — Active Sessions + Login History for one admin, reachable
// from the Admin Users list ("Sessions" link on each row).
export default function AdminSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { show } = useToast();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [history, setHistory] = useState<LoginHistoryRow[] | null>(null);

  function load() {
    fetch(`/api/admin/admin-sessions?adminId=${id}`)
      .then((r) => r.json())
      .then((data) => setSessions(data.items ?? []));
    fetch(`/api/admin/login-history?adminId=${id}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.items ?? []));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function revoke(sessionId: string) {
    const res = await fetch(`/api/admin/admin-sessions/${sessionId}/revoke`, { method: "POST" });
    if (!res.ok) {
      show("Could not revoke session.", "error");
      return;
    }
    show("Session revoked.", "success");
    load();
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/admin-users" className={buttonClass({ variant: "outline", size: "sm" })}>
        <ArrowLeft className="h-4 w-4" /> Back to Admin Users
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold">Sessions & Login History</h1>
      </div>

      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Active Sessions</p>
        {sessions === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        ) : sessions.filter((s) => !s.revoked).length === 0 ? (
          <p className="text-sm text-muted">No active sessions.</p>
        ) : (
          <div className="space-y-2">
            {sessions.filter((s) => !s.revoked).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex items-center gap-3">
                  <Monitor className="h-4 w-4 text-muted" />
                  <div>
                    <p className="text-sm font-medium">
                      {s.deviceInfo ?? "Unknown device"} {s.isCurrent && <Badge variant="success">This device</Badge>}
                    </p>
                    <p className="text-xs text-muted">
                      {s.ipAddress ?? "Unknown IP"} · Last active {formatDateTime(s.lastActiveAt)} · Signed in {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => revoke(s.id)}>
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Login History</p>
        {history === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted">No login history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Event</th>
                  <th className="pb-2">Date/Time</th>
                  <th className="pb-2">IP</th>
                  <th className="pb-2">Device</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border">
                    <td className="py-2">
                      <Badge variant={h.event === "SUCCESS" ? "success" : h.event === "LOCKED" ? "danger" : "warning"}>{h.event}</Badge>
                    </td>
                    <td className="py-2 text-muted">{formatDateTime(h.createdAt)}</td>
                    <td className="py-2 text-muted">{h.ipAddress ?? "—"}</td>
                    <td className="py-2 text-muted">{h.userAgent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
