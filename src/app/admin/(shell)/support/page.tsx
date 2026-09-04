"use client";

import { useEffect, useState } from "react";
import { Loader2, Inbox, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/utils";

interface SupportMessageRow {
  id: string;
  profileCode: string | null;
  email: string;
  subject: string;
  message: string;
  resolved: boolean;
  createdAt: string;
}

export default function AdminSupportPage() {
  const [items, setItems] = useState<SupportMessageRow[] | null>(null);

  function load() {
    fetch("/api/admin/support")
      .then((r) => r.json())
      .then((data) => setItems(data.items ?? []));
  }

  useEffect(() => {
    load();
  }, []);

  async function markResolved(id: string, resolved: boolean) {
    await fetch(`/api/admin/support/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Support Messages</h1>
        <p className="text-sm text-muted">Messages submitted through the public Support page.</p>
      </div>

      {items === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="No support messages" />
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <Card key={m.id}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{m.subject}</p>
                    <p className="text-xs text-muted">
                      {m.email} {m.profileCode && <>&middot; {m.profileCode}</>} &middot; {formatDateTime(m.createdAt)}
                    </p>
                  </div>
                  <Badge variant={m.resolved ? "success" : "warning"}>{m.resolved ? "Resolved" : "Open"}</Badge>
                </div>
                <p className="text-sm">{m.message}</p>
                {!m.resolved && (
                  <Button size="sm" variant="outline" onClick={() => markResolved(m.id, true)}>
                    <Check className="h-4 w-4" /> Mark Resolved
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
