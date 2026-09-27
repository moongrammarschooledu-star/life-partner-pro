"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

interface PolicyHistoryRow {
  id: string;
  policyVersion: number;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
interface PolicyItem {
  policyKey: string;
  value: unknown;
  history: PolicyHistoryRow[];
}

function PolicyCard({ item, onSaved }: { item: PolicyItem; onSaved: () => void }) {
  const { show } = useToast();
  const [draft, setDraft] = useState(JSON.stringify(item.value));
  const [busy, setBusy] = useState(false);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      show("Enter a valid JSON value (e.g. true, 90, \"mock\").", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/verification/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyKey: item.policyKey, configuration: parsed }),
      });
      if (!res.ok) throw new Error();
      show("Policy updated", "success");
      onSaved();
    } catch {
      show("Could not update this policy.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-mono">{item.policyKey}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} className="font-mono text-sm" />
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </Button>
        </div>
        {item.history.length > 0 && (
          <p className="text-xs text-muted">
            Version {item.history[0].policyVersion} · effective since {formatDateTime(item.history[0].effectiveFrom)}
            {item.history.length > 1 ? ` · ${item.history.length} version(s) total` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerificationPoliciesPage() {
  const [items, setItems] = useState<PolicyItem[] | null>(null);

  function load() {
    fetch("/api/admin/verification/policies")
      .then((r) => r.json())
      .then((json) => setItems(json.items ?? []));
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Verification Policies</h1>
        <p className="text-sm text-muted">
          Configurable, versioned platform policy — every change creates a new version with an effective date and an audit trail; nothing is
          overwritten in place.
        </p>
      </div>

      {items === null ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Settings2} title="No policies configured" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <PolicyCard key={item.policyKey} item={item} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}
