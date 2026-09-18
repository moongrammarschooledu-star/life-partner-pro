"use client";

import { useEffect, useState } from "react";
import { Loader2, Package as PackageIcon, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";
import { formatMoney } from "@/lib/finance/money";

interface PackagePrice { amountMinor: number; currencyCode: string }
interface PackageEntitlement { featureKey: string; limitValue: number | null; resetPeriod: string | null }
interface PackageRow {
  id: string; packageCode: string; name: string; description: string; billingType: string;
  durationDays: number | null; trialDays: number; active: boolean;
  prices: PackagePrice[]; entitlements: PackageEntitlement[];
}

const BILLING_TYPES = ["ONE_TIME", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "CUSTOM"];

export default function PackagesPage() {
  const { show } = useToast();
  const [items, setItems] = useState<PackageRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [billingType, setBillingType] = useState("MONTHLY");
  const [durationDays, setDurationDays] = useState("30");
  const [amount, setAmount] = useState("1000");
  const [currencyCode, setCurrencyCode] = useState("PKR");
  const [entitlementTarget, setEntitlementTarget] = useState<string | null>(null);
  const [featureKey, setFeatureKey] = useState("");
  const [limitValue, setLimitValue] = useState("");
  const [resetPeriod, setResetPeriod] = useState("MONTHLY");

  function load() {
    fetch("/api/admin/packages").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function createPackage() {
    const res = await fetch("/api/admin/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, billingType, durationDays: billingType === "ONE_TIME" ? null : Number(durationDays), amountMinor: Math.round(Number(amount) * 100), currencyCode }),
    });
    if (res.ok) {
      show("Package created", "success");
      setCreating(false);
      setName("");
      setDescription("");
      load();
    } else {
      show((await res.json()).error ?? "Could not create package.", "error");
    }
  }

  async function toggleActive(id: string, active: boolean) {
    const res = await fetch(`/api/admin/packages/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) });
    if (res.ok) { show("Updated", "success"); load(); }
  }

  async function addEntitlement() {
    if (!entitlementTarget) return;
    const res = await fetch(`/api/admin/packages/${entitlementTarget}/entitlements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureKey, limitValue: limitValue ? Number(limitValue) : null, resetPeriod: resetPeriod || null }),
    });
    if (res.ok) {
      show("Entitlement added", "success");
      setEntitlementTarget(null);
      setFeatureKey("");
      setLimitValue("");
      load();
    }
  }

  if (items === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Packages</h1>
          <p className="text-sm text-muted">Configure paid packages, versioned pricing, and feature entitlements.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New Package</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={PackageIcon} title="No packages yet" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <div key={p.id} className="rounded-xl border border-border bg-surface p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-heading font-semibold">{p.name}</h3>
                <Badge variant={p.active ? "success" : "muted"}>{p.active ? "Active" : "Disabled"}</Badge>
              </div>
              <p className="text-xs font-mono text-muted">{p.packageCode}</p>
              <p className="text-sm text-muted">{p.description}</p>
              <p className="text-lg font-semibold">{p.prices[0] ? formatMoney(p.prices[0].amountMinor, p.prices[0].currencyCode) : "No price set"}</p>
              <p className="text-xs text-muted">{formatEnumLabel(p.billingType)}{p.durationDays ? ` · ${p.durationDays} days` : ""}{p.trialDays > 0 ? ` · ${p.trialDays}-day trial` : ""}</p>
              <div className="flex flex-wrap gap-1">
                {p.entitlements.map((e) => (
                  <Badge key={e.featureKey} variant="info">{e.featureKey}{e.limitValue != null ? ` (${e.limitValue}/${formatEnumLabel(e.resetPeriod ?? "term")})` : ""}</Badge>
                ))}
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => setEntitlementTarget(p.id)}>Add Entitlement</Button>
                <Button size="sm" variant="outline" onClick={() => toggleActive(p.id, p.active)}>{p.active ? "Disable" : "Enable"}</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog open={creating} title="Create Package" description="Sets the first price version automatically." confirmLabel="Create" onConfirm={createPackage} onCancel={() => setCreating(false)}>
        <Field label="Name" htmlFor="pkg-name">
          <Input id="pkg-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="pkg-desc">
          <Textarea id="pkg-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Billing Type" htmlFor="pkg-billing">
          <Select id="pkg-billing" value={billingType} onChange={(e) => setBillingType(e.target.value)}>
            {BILLING_TYPES.map((t) => <option key={t} value={t}>{formatEnumLabel(t)}</option>)}
          </Select>
        </Field>
        {billingType !== "ONE_TIME" && (
          <Field label="Duration (days)" htmlFor="pkg-duration">
            <Input id="pkg-duration" type="number" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} />
          </Field>
        )}
        <Field label="Price" htmlFor="pkg-amount">
          <Input id="pkg-amount" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Currency" htmlFor="pkg-currency">
          <Input id="pkg-currency" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog open={!!entitlementTarget} title="Add Feature Entitlement" description="featureKey is free text (e.g. matching.priority) — no schema change needed for new features." confirmLabel="Add" confirmDisabled={!featureKey.trim()} onConfirm={addEntitlement} onCancel={() => setEntitlementTarget(null)}>
        <Field label="Feature Key" htmlFor="ent-key">
          <Input id="ent-key" value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} placeholder="support.priority" />
        </Field>
        <Field label="Usage Limit (optional)" htmlFor="ent-limit" hint="Leave blank for unlimited.">
          <Input id="ent-limit" type="number" value={limitValue} onChange={(e) => setLimitValue(e.target.value)} />
        </Field>
        <Field label="Reset Period" htmlFor="ent-reset">
          <Select id="ent-reset" value={resetPeriod} onChange={(e) => setResetPeriod(e.target.value)}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
            <option value="">Lifetime (subscription term)</option>
          </Select>
        </Field>
      </ConfirmDialog>
    </div>
  );
}
