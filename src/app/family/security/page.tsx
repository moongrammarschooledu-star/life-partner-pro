"use client";

import { useEffect, useState } from "react";
import { Loader2, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

interface Session { id: string; deviceInfo: string | null; lastActiveAt: string; createdAt: string; }

export default function FamilySecurityPage() {
  const { show } = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/family/sessions").then((r) => (r.ok ? r.json() : null)).then((j) => setSessions(j?.items ?? []));
  }
  useEffect(load, []);

  async function revoke(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/family/sessions/${id}`, { method: "DELETE" });
      if (res.ok) { show("Session signed out.", "success"); load(); }
    } finally {
      setBusy(null);
    }
  }

  if (sessions === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Security</h1>
        <p className="mt-1 text-sm text-muted">Your active sessions. You can sign out any device other than this one.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Active Sessions</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted" />
                <div>
                  <p>{s.deviceInfo ?? "Unknown device"}</p>
                  <p className="text-xs text-muted">Last active {formatDateTime(s.lastActiveAt)}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => revoke(s.id)} disabled={busy === s.id}>Sign Out</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
