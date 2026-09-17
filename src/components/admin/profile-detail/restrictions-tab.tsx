"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldOff, LifeBuoy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatEnumLabel } from "@/lib/utils";

interface Restriction {
  id: string;
  restrictionType: string;
  reason: string;
  active: boolean;
  startDate: string;
  endDate: string | null;
  appliedBy: { name: string };
  liftedBy: { name: string } | null;
}

interface RelatedCase {
  id: string;
  caseNumber: string;
  type: string;
  subject: string;
  status: string;
}

const RESTRICTION_TYPES = ["CANNOT_MATCH", "CANNOT_RECEIVE_PROPOSAL", "CANNOT_CONTACT_SHARE", "CANNOT_SCHEDULE_MEETING", "CANNOT_UPDATE_FIELDS"];

// Spec §16/§18 — applying a restriction is a high-risk action requiring a
// password re-confirmation, matching STEP 11's established reauth step-up
// pattern (see admin-users deactivation).
export function RestrictionsTab({ profileId }: { profileId: string }) {
  const { show } = useToast();
  const [restrictions, setRestrictions] = useState<Restriction[] | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [cases, setCases] = useState<RelatedCase[] | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [restrictionType, setRestrictionType] = useState(RESTRICTION_TYPES[0]);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/admin/profiles/${profileId}/restrictions`).then((r) => r.json()).then((j) => { setRestrictions(j.items ?? []); setAccountStatus(j.accountStatus ?? "ACTIVE"); });
    fetch(`/api/admin/cases?relatedToProfileId=${profileId}`).then((r) => r.json()).then((j) => setCases(j.items ?? [])).catch(() => setCases([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const reauth = await fetch("/api/admin/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!reauth.ok) {
        setError((await reauth.json()).error ?? "Incorrect password.");
        return;
      }
      const res = await fetch(`/api/admin/profiles/${profileId}/restrictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restrictionType, reason }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Could not apply restriction.");
        return;
      }
      show("Restriction applied", "success");
      setApplyOpen(false);
      setReason("");
      setPassword("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function lift(restrictionId: string) {
    const res = await fetch(`/api/admin/profiles/${profileId}/restrictions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restrictionId }),
    });
    if (!res.ok) {
      show("Could not lift restriction.", "error");
      return;
    }
    show("Restriction lifted", "success");
    load();
  }

  return (
    <div className="space-y-4">
      {accountStatus && accountStatus !== "ACTIVE" && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
          Account status: <Badge variant="warning">{formatEnumLabel(accountStatus)}</Badge>
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><ShieldOff className="h-4 w-4" /> Restrictions</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setApplyOpen(true)}>Apply Restriction</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {restrictions === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : restrictions.filter((r) => r.active).length === 0 ? (
            <p className="text-sm text-muted">No active restrictions.</p>
          ) : (
            restrictions.filter((r) => r.active).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                <div>
                  <p className="font-medium">{formatEnumLabel(r.restrictionType)}</p>
                  <p className="text-xs text-muted">{r.reason} — by {r.appliedBy.name}, {formatDateTime(r.startDate)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => lift(r.id)}>Lift</Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><LifeBuoy className="h-4 w-4" /> Related Cases</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {cases === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : cases.length === 0 ? (
            <EmptyState icon={LifeBuoy} title="No related cases" />
          ) : (
            cases.map((c) => (
              <Link key={c.id} href={`/admin/case-management/${c.id}`} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm hover:bg-surface-muted">
                <span className="font-mono text-xs">{c.caseNumber}</span>
                <span className="flex-1 px-3">{c.subject}</span>
                <Badge variant="muted">{formatEnumLabel(c.status)}</Badge>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={applyOpen}
        title="Apply Restriction"
        description="This restricts specific platform actions for this profile and is enforced by the backend, not just hidden in the UI."
        confirmLabel="Apply Restriction"
        danger
        confirmDisabled={busy || !reason.trim() || !password}
        onConfirm={apply}
        onCancel={() => setApplyOpen(false)}
      >
        <Field label="Restriction Type" htmlFor="restrictionType">
          <Select id="restrictionType" value={restrictionType} onChange={(e) => setRestrictionType(e.target.value)}>
            {RESTRICTION_TYPES.map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}
          </Select>
        </Field>
        <Field label="Reason" htmlFor="restrictReason">
          <Input id="restrictReason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Confirm your password" htmlFor="restrictPassword" hint="Required for this sensitive action.">
          <Input id="restrictPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
      </ConfirmDialog>
    </div>
  );
}
