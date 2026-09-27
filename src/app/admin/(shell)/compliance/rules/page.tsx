"use client";

import { useEffect, useState } from "react";
import { Loader2, ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

interface Rule {
  id: string;
  ruleCode: string;
  jurisdictionId: string;
  subject: string;
  requirementType: string;
  description: string;
  status: string;
  ruleVersion: number;
  reviewDate: string | null;
}

interface Jurisdiction {
  id: string;
  jurisdictionCode: string;
  name: string;
}

const SOURCE_TYPES = ["LAW", "REGULATION", "REGULATOR_GUIDANCE", "COURT_DECISION", "CONTRACT", "PROVIDER_REQUIREMENT", "INTERNAL_POLICY", "LEGAL_COUNSEL_ADVICE"];

function ActionDialog({ open, title, onConfirm, onCancel }: { open: boolean; title: string; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmDialog open={open} title={title} description="This action is audited." confirmLabel="Confirm" onConfirm={() => onConfirm(reason)} onCancel={() => { setReason(""); onCancel(); }}>
      <Field label="Reason" htmlFor="rule-action-reason">
        <Textarea id="rule-action-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

export default function RulesPage() {
  const { show } = useToast();
  const [items, setItems] = useState<Rule[] | null>(null);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [status, setStatus] = useState("ACTIVE");
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const [suspending, setSuspending] = useState<string | null>(null);

  const [jurisdictionId, setJurisdictionId] = useState("");
  const [subject, setSubject] = useState("");
  const [requirementType, setRequirementType] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState(SOURCE_TYPES[0]);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [configurationJson, setConfigurationJson] = useState("{}");

  function load() {
    fetch(`/api/admin/compliance/rules?status=${status}`)
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []));
  }
  useEffect(load, [status]);
  useEffect(() => {
    fetch("/api/admin/compliance/jurisdictions")
      .then((r) => r.json())
      .then((j) => setJurisdictions(j.items ?? []));
  }, []);

  async function create() {
    let configuration: unknown;
    try {
      configuration = JSON.parse(configurationJson);
    } catch {
      show("Configuration must be valid JSON.", "error");
      return;
    }
    const res = await fetch("/api/admin/compliance/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jurisdictionId, subject, requirementType, description, sourceType, effectiveFrom, configuration }),
    });
    if (res.ok) {
      show("Rule created as DRAFT", "success");
      setCreating(false);
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      show(body.error ?? "Could not create rule.", "error");
    }
  }

  async function submit(id: string) {
    const res = await fetch(`/api/admin/compliance/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submit: true }),
    });
    if (res.ok) {
      show("Submitted for review", "success");
      load();
    } else show("Could not submit for review.", "error");
  }

  async function approve(id: string, reason: string) {
    const res = await fetch(`/api/admin/compliance/rules/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setApproving(null);
    if (res.status === 202) show("Approval requested — awaiting a second approver.", "success");
    else if (res.ok) show("Rule approved", "success");
    else show("Could not approve rule.", "error");
    load();
  }

  async function activate(id: string) {
    const res = await fetch(`/api/admin/compliance/rules/${id}/activate`, { method: "POST" });
    if (res.ok) {
      show("Rule activated", "success");
      load();
    } else show("Could not activate rule.", "error");
  }

  async function suspend(id: string, reason: string) {
    const res = await fetch(`/api/admin/compliance/rules/${id}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setSuspending(null);
    if (res.ok) {
      show("Rule suspended", "success");
      load();
    } else show("Could not suspend rule.", "error");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Compliance Rules</h1>
          <p className="text-sm text-muted">
            DRAFT → UNDER_REVIEW → APPROVED → ACTIVE. Only ACTIVE rules affect production behavior; activating one requires a second
            approver.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          New Rule
        </Button>
      </div>

      <Tabs
        value={status}
        onChange={setStatus}
        tabs={["DRAFT", "UNDER_REVIEW", "APPROVED", "ACTIVE", "SUSPENDED", "EXPIRED", "RETIRED"].map((s) => ({ value: s, label: s }))}
      />

      <Card>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={ScrollText} title="No rules in this status" />
          ) : (
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs">{r.ruleCode} · v{r.ruleVersion}</p>
                      <p className="font-medium">{r.requirementType} — {r.subject}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{r.description}</p>
                  {r.reviewDate && <p className="mt-1 text-xs text-muted">Review due {formatDate(r.reviewDate)}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.status === "DRAFT" && (
                      <Button size="sm" variant="outline" onClick={() => submit(r.id)}>
                        Submit for Review
                      </Button>
                    )}
                    {r.status === "UNDER_REVIEW" && (
                      <Button size="sm" variant="outline" onClick={() => setApproving(r.id)}>
                        Approve
                      </Button>
                    )}
                    {r.status === "APPROVED" && (
                      <Button size="sm" onClick={() => activate(r.id)}>
                        Activate
                      </Button>
                    )}
                    {r.status === "ACTIVE" && (
                      <Button size="sm" variant="outline" onClick={() => setSuspending(r.id)}>
                        Suspend
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={creating}
        title="New Compliance Rule"
        description={'Starts as DRAFT. Configuration is a JSON object read by the rule engine (e.g. { "minAge": 18 }).'}
        confirmLabel="Create"
        onConfirm={create}
        onCancel={() => setCreating(false)}
      >
        <Field label="Jurisdiction" htmlFor="rule-jurisdiction">
          <Select id="rule-jurisdiction" value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)}>
            <option value="">Select…</option>
            {jurisdictions.map((j) => (
              <option key={j.id} value={j.id}>
                {j.jurisdictionCode} — {j.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Requirement type" htmlFor="rule-requirement">
          <Input id="rule-requirement" placeholder="AGE_MINIMUM, RETENTION_PERIOD, ..." value={requirementType} onChange={(e) => setRequirementType(e.target.value)} />
        </Field>
        <Field label="Subject (scope)" htmlFor="rule-subject">
          <Input id="rule-subject" placeholder="e.g. * or consent.matchmaking" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="rule-description">
          <Textarea id="rule-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Source type" htmlFor="rule-source-type">
          <Select id="rule-source-type" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Effective from" htmlFor="rule-effective-from">
          <Input id="rule-effective-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <Field label="Configuration (JSON)" htmlFor="rule-configuration">
          <Textarea id="rule-configuration" rows={3} value={configurationJson} onChange={(e) => setConfigurationJson(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ActionDialog open={!!approving} title="Approve Compliance Rule" onConfirm={(reason) => approving && approve(approving, reason)} onCancel={() => setApproving(null)} />
      <ActionDialog open={!!suspending} title="Suspend Compliance Rule" onConfirm={(reason) => suspending && suspend(suspending, reason)} onCancel={() => setSuspending(null)} />
    </div>
  );
}
