"use client";

import { useEffect, useState } from "react";
import { Loader2, Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

interface Processor {
  id: string;
  processorCode: string;
  name: string;
  serviceType: string;
  country: string;
  contractStatus: string;
  complianceStatus: string;
  lastReviewedAt: string | null;
  nextReviewDue: string | null;
}

const COMPLIANCE_STATUSES = ["REVIEW_REQUIRED", "COMPLIANT", "NON_COMPLIANT", "UNDER_REVIEW"];

export default function ProcessorsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<Processor[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [country, setCountry] = useState("");

  const [reviewStatus, setReviewStatus] = useState(COMPLIANCE_STATUSES[0]);
  const [reviewNote, setReviewNote] = useState("");

  function load() {
    fetch("/api/admin/compliance/processors")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function create() {
    const res = await fetch("/api/admin/compliance/processors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, serviceType, country, processingRegions: [], dataTypes: [] }),
    });
    if (res.ok) {
      show("Processor recorded (REVIEW_REQUIRED by default)", "success");
      setCreating(false);
      setName("");
      setServiceType("");
      setCountry("");
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      show(body.error ?? "Could not record processor.", "error");
    }
  }

  async function review(id: string) {
    const res = await fetch(`/api/admin/compliance/processors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complianceStatus: reviewStatus, reviewNote }),
    });
    setReviewing(null);
    setReviewNote("");
    if (res.ok) {
      show("Review recorded", "success");
      load();
    } else show("Could not record review.", "error");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Processor Register</h1>
          <p className="text-sm text-muted">
            A new processor always starts REVIEW_REQUIRED — never auto-marked compliant from a certification or technical config. Only an
            explicit review changes its status.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          Add Processor
        </Button>
      </div>

      <Card>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Building2} title="No processors recorded yet" />
          ) : (
            <div className="space-y-2">
              {items.map((p) => (
                <div key={p.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs">{p.processorCode}</p>
                      <p className="font-medium">
                        {p.name} · {p.serviceType} · {p.country}
                      </p>
                    </div>
                    <StatusBadge status={p.complianceStatus} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Contract: {p.contractStatus}
                    {p.nextReviewDue ? ` · Next review due ${formatDate(p.nextReviewDue)}` : ""}
                  </p>
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => setReviewing(p.id)}>
                      Record Review
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog open={creating} title="Add Processor" description="Records a real third-party processor." confirmLabel="Add" onConfirm={create} onCancel={() => setCreating(false)}>
        <Field label="Name" htmlFor="proc-name">
          <Input id="proc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Service type" htmlFor="proc-service-type">
          <Input id="proc-service-type" placeholder="IDENTITY_VERIFICATION, EMAIL, PAYMENT, AI, ..." value={serviceType} onChange={(e) => setServiceType(e.target.value)} />
        </Field>
        <Field label="Country" htmlFor="proc-country">
          <Input id="proc-country" value={country} onChange={(e) => setCountry(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!reviewing}
        title="Record Processor Review"
        description="An explicit, reviewer-driven decision — never inferred."
        confirmLabel="Save Review"
        onConfirm={() => reviewing && review(reviewing)}
        onCancel={() => setReviewing(null)}
      >
        <Field label="Compliance status" htmlFor="proc-review-status">
          <Select id="proc-review-status" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
            {COMPLIANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Review note" htmlFor="proc-review-note">
          <Textarea id="proc-review-note" rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
