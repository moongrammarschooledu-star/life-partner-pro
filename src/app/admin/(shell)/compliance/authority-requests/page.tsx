"use client";

import { useEffect, useState } from "react";
import { Loader2, Gavel } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

interface AuthorityRequest {
  id: string;
  requestCode: string;
  requestType: string;
  authority: string;
  scope: string;
  verificationStatus: string;
  legalReviewStatus: string;
  deadline: string | null;
  disclosureDate: string | null;
}

const REQUEST_TYPES = ["LAW_ENFORCEMENT", "REGULATOR", "COURT_ORDER", "LEGAL_NOTICE", "OTHER_AUTHORITY"];
const REVIEW_STATUSES = ["UNDER_REVIEW", "APPROVED", "REJECTED"];

export default function AuthorityRequestsPage() {
  const { show } = useToast();
  const [items, setItems] = useState<AuthorityRequest[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [disclosing, setDisclosing] = useState<string | null>(null);

  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [authority, setAuthority] = useState("");
  const [scope, setScope] = useState("");
  const [deadline, setDeadline] = useState("");

  const [verifyNote, setVerifyNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState(REVIEW_STATUSES[0]);
  const [reviewNote, setReviewNote] = useState("");
  const [disclosureScope, setDisclosureScope] = useState("");
  const [disclosureReason, setDisclosureReason] = useState("");

  function load() {
    fetch("/api/admin/compliance/authority-requests")
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function create() {
    const res = await fetch("/api/admin/compliance/authority-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType, authority, scope, deadline: deadline || undefined }),
    });
    if (res.ok) {
      show("Authority request logged (UNVERIFIED)", "success");
      setCreating(false);
      setAuthority("");
      setScope("");
      setDeadline("");
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      show(body.error ?? "Could not log request.", "error");
    }
  }

  async function verify(id: string, verified: boolean) {
    const res = await fetch(`/api/admin/compliance/authority-requests/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verified, note: verifyNote }),
    });
    setVerifying(null);
    setVerifyNote("");
    if (res.ok) {
      show(verified ? "Marked verified" : "Marked not verified", "success");
      load();
    } else show("Could not record verification.", "error");
  }

  async function review(id: string) {
    const res = await fetch(`/api/admin/compliance/authority-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ legalReviewStatus: reviewStatus, note: reviewNote }),
    });
    setReviewing(null);
    setReviewNote("");
    if (res.ok) {
      show("Legal review recorded", "success");
      load();
    } else show("Could not record legal review.", "error");
  }

  async function disclose(id: string) {
    const res = await fetch(`/api/admin/compliance/authority-requests/${id}/disclose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvedDisclosureScope: disclosureScope, disclosedData: { note: disclosureScope }, reason: disclosureReason }),
    });
    setDisclosing(null);
    setDisclosureScope("");
    setDisclosureReason("");
    if (res.status === 202) show("Disclosure requested — awaiting a second approver.", "success");
    else if (res.ok) show("Disclosure recorded", "success");
    else {
      const body = await res.json().catch(() => ({}));
      show(body.error ?? "Could not disclose.", "error");
    }
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Authority Requests</h1>
          <p className="text-sm text-muted">
            Verification and legal review are independent checks — disclosure is only possible once BOTH have cleared, gated by a
            Super-Admin-only approval. There is no emergency bypass.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          Log Request
        </Button>
      </div>

      <Card>
        <CardContent>
          {items === null ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Gavel} title="No authority requests logged" />
          ) : (
            <div className="space-y-2">
              {items.map((r) => (
                <div key={r.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-xs">{r.requestCode}</p>
                      <p className="font-medium">
                        {r.requestType} — {r.authority}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={r.verificationStatus} />
                      <StatusBadge status={r.legalReviewStatus} />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">{r.scope}</p>
                  {r.deadline && <p className="mt-1 text-xs text-muted">Deadline {formatDate(r.deadline)}</p>}
                  {r.disclosureDate ? (
                    <p className="mt-1 text-xs text-success">Disclosed {formatDate(r.disclosureDate)}</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.verificationStatus === "UNVERIFIED" && (
                        <Button size="sm" variant="outline" onClick={() => setVerifying(r.id)}>
                          Verify
                        </Button>
                      )}
                      {r.legalReviewStatus === "PENDING" && (
                        <Button size="sm" variant="outline" onClick={() => setReviewing(r.id)}>
                          Legal Review
                        </Button>
                      )}
                      {r.verificationStatus === "VERIFIED" && r.legalReviewStatus === "APPROVED" && (
                        <Button size="sm" onClick={() => setDisclosing(r.id)}>
                          Disclose
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog open={creating} title="Log Authority Request" description="Starts UNVERIFIED / PENDING." confirmLabel="Log Request" onConfirm={create} onCancel={() => setCreating(false)}>
        <Field label="Request type" htmlFor="ar-type">
          <Select id="ar-type" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            {REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Authority" htmlFor="ar-authority">
          <Input id="ar-authority" value={authority} onChange={(e) => setAuthority(e.target.value)} />
        </Field>
        <Field label="Scope" htmlFor="ar-scope">
          <Textarea id="ar-scope" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} />
        </Field>
        <Field label="Deadline (optional)" htmlFor="ar-deadline">
          <Input id="ar-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog open={!!verifying} title="Verify Authority Request" description="Confirm this request genuinely came from the claimed authority." confirmLabel="Save" onConfirm={() => verifying && verify(verifying, true)} onCancel={() => setVerifying(null)}>
        <Field label="Note" htmlFor="ar-verify-note">
          <Textarea id="ar-verify-note" rows={2} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
        </Field>
        <Button variant="outline" className="w-full" onClick={() => verifying && verify(verifying, false)}>
          Mark Not Verified Instead
        </Button>
      </ConfirmDialog>

      <ConfirmDialog open={!!reviewing} title="Legal Review Decision" description="Independent of verification — both must clear before disclosure." confirmLabel="Save" onConfirm={() => reviewing && review(reviewing)} onCancel={() => setReviewing(null)}>
        <Field label="Decision" htmlFor="ar-review-status">
          <Select id="ar-review-status" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" htmlFor="ar-review-note">
          <Textarea id="ar-review-note" rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog open={!!disclosing} title="Disclose to Authority" description="Requires Super Admin approval — this only submits the request." confirmLabel="Submit for Approval" danger onConfirm={() => disclosing && disclose(disclosing)} onCancel={() => setDisclosing(null)}>
        <Field label="Approved disclosure scope" htmlFor="ar-disclosure-scope">
          <Textarea id="ar-disclosure-scope" rows={2} value={disclosureScope} onChange={(e) => setDisclosureScope(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="ar-disclosure-reason">
          <Textarea id="ar-disclosure-reason" rows={2} value={disclosureReason} onChange={(e) => setDisclosureReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
