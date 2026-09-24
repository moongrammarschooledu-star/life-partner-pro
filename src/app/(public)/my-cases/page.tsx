"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, LifeBuoy, Plus, ShieldAlert, Search, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button, buttonClass } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatEnumLabel } from "@/lib/utils";

interface CaseRow {
  id: string;
  caseNumber: string;
  type: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_GROUPS = [
  { key: "OPEN", statuses: ["NEW", "ACKNOWLEDGED", "ASSIGNED", "IN_REVIEW", "ESCALATED", "ACTION_REQUIRED", "REOPENED"], label: "Open Requests" },
  { key: "WAITING", statuses: ["WAITING_FOR_USER", "WAITING_FOR_STAFF"], label: "Waiting for Response" },
  { key: "RESOLVED", statuses: ["RESOLVED"], label: "Resolved" },
  { key: "CLOSED", statuses: ["CLOSED", "ARCHIVED"], label: "Closed" },
];

export default function MyCasesPage() {
  const { show } = useToast();
  const [items, setItems] = useState<CaseRow[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  function load() {
    fetch("/api/my-cases")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setItems(data.items ?? []);
          setSignedIn(true);
        } else {
          setSignedIn(false);
        }
      });
  }

  useEffect(() => {
    load();
  }, []);

  // Reuses the existing /api/my-status identity-proof endpoint — same
  // pattern as /my-proposals — which establishes the shared signed
  // applicant-session cookie this page reads.
  async function lookup() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileCode, email }),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Profile not found.", "error");
        return;
      }
      load();
    } finally {
      setLookingUp(false);
    }
  }

  if (signedIn === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Help &amp; Support</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to view or create requests.</p>
        <Card className="mt-6">
          <CardContent className="space-y-4">
            <Field label="Profile ID" htmlFor="profileCode">
              <Input id="profileCode" value={profileCode} onChange={(e) => setProfileCode(e.target.value)} placeholder="LPP-000123" />
            </Field>
            <Field label="Registered Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Button onClick={lookup} disabled={lookingUp || !profileCode || !email}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Continue
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const counts = STATUS_GROUPS.map((g) => ({ ...g, count: items?.filter((i) => g.statuses.includes(i.status)).length ?? 0 }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="mb-2 flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Help &amp; Support</h1>
          <p className="text-sm text-muted">Support requests, complaints, and safety reports you&apos;ve submitted.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/my-cases/new?type=SAFETY_REPORT" className={buttonClass({ variant: "outline", size: "sm" })}>
            <ShieldAlert className="h-4 w-4" /> Report a Safety Concern
          </Link>
          <Link href="/my-cases/new" className={buttonClass({ size: "sm" })}>
            <Plus className="h-4 w-4" /> Create New Request
          </Link>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map((c) => (
          <Card key={c.key}>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-semibold">{c.count}</p>
              <p className="text-xs text-muted">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {items === null ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No requests yet" description="Create a request if you need help, want to file a complaint, or report a safety concern." />
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <Link key={c.id} href={`/my-cases/${c.id}`} className="block">
              <Card className="transition-colors hover:bg-surface-muted">
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-mono text-xs text-muted">{c.caseNumber}</p>
                    <p className="font-medium">{c.subject}</p>
                    <p className="text-xs text-muted">{formatEnumLabel(c.type)} · {formatEnumLabel(c.category)} · {formatDate(c.createdAt)}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
