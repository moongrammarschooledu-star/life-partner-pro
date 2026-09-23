"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Siren } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SensitiveActionDialog, callApi } from "@/components/admin/system/shared";
import type { AssignmentResourceType } from "@prisma/client";

const SOURCE_TYPES: AssignmentResourceType[] = ["PROFILE", "PROPOSAL", "VERIFICATION", "CASE", "PAYMENT", "PRIVACY_REQUEST", "AI_SAFETY_EVENT", "ADMIN_USER"];

// STEP 19 §25 — Super-Admin-only (approvals:emergency-override). Every use
// is fully logged and creates a mandatory post-action review task — never a
// silent bypass. Confirmation always requires a fresh password re-entry via
// SensitiveActionDialog (the same primitive as refund execution/break-glass).
export default function EmergencyOverridePage() {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [actionType, setActionType] = useState("");
  const [sourceType, setSourceType] = useState<AssignmentResourceType>("PROFILE");
  const [sourceId, setSourceId] = useState("");
  const [category, setCategory] = useState("");

  async function submit(params: { reason: string; stepUpToken: string }) {
    if (!actionType.trim()) return "actionType is required.";
    if (!sourceId.trim()) return "sourceId is required.";
    if (!category.trim()) return "An emergency category is required.";

    const res = await callApi("/api/admin/approvals/emergency-override", "POST", {
      actionType: actionType.trim(),
      sourceType,
      sourceId: sourceId.trim(),
      category: category.trim(),
      reason: params.reason,
      reauthToken: params.stepUpToken,
    });
    if (!res.ok) return res.data.error ?? "Could not use the emergency override.";
    show("Emergency override recorded — a post-action review task has been created.", "success");
    setActionType(""); setSourceId(""); setCategory("");
    return null;
  }

  return (
    <div className="space-y-4">
      <Link href="/admin/approvals" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Approvals
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold text-danger">Emergency Override</h1>
        <p className="text-sm text-muted">Bypasses the normal maker-checker wait for a genuine emergency — never logging bypass. Every use is fully audited, notifies Security/Super Admins, and creates a mandatory post-action review task.</p>
      </div>

      <Card className="border-danger/40">
        <CardHeader><CardTitle className="text-base">Use Emergency Override</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Field label="Action Type" htmlFor="eo-action" hint="Must have Emergency Override enabled in Governance Policies.">
            <Input id="eo-action" placeholder="e.g. SAFETY_RESTRICTION" value={actionType} onChange={(e) => setActionType(e.target.value)} />
          </Field>
          <Field label="Source Type" htmlFor="eo-source-type">
            <Select id="eo-source-type" value={sourceType} onChange={(e) => setSourceType(e.target.value as AssignmentResourceType)}>
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Source Record ID" htmlFor="eo-source-id">
            <Input id="eo-source-id" value={sourceId} onChange={(e) => setSourceId(e.target.value)} />
          </Field>
          <Field label="Emergency Category" htmlFor="eo-category">
            <Input id="eo-category" placeholder="e.g. SAFETY" value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Button variant="danger" onClick={() => setOpen(true)}>
            <Siren className="h-4 w-4" /> Use Emergency Override
          </Button>
        </CardContent>
      </Card>

      <SensitiveActionDialog
        open={open}
        title="Confirm Emergency Override"
        description="This immediately approves the action and creates a mandatory post-action review task. This is never used for routine decisions."
        confirmLabel="Confirm Override"
        danger
        onCancel={() => setOpen(false)}
        onConfirm={submit}
      />
    </div>
  );
}
