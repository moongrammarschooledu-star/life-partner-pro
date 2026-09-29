"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, ShieldAlert } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";
import { formatMoney } from "@/lib/finance/money";

const TABS = [
  { value: "entitlements", label: "Entitlements" },
  { value: "overrides", label: "Overrides" },
  { value: "promotions", label: "Promotions" },
  { value: "referrals", label: "Referrals" },
  { value: "credits", label: "Credits" },
];

export default function MembershipCenterPage() {
  const [tab, setTab] = useState("entitlements");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Membership Center</h1>
        <p className="text-sm text-muted">Feature entitlements, overrides, promotions, referrals, and service credits. Package/pricing/coupon management lives in Packages and Finance Center.</p>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "entitlements" && <EntitlementsSection />}
      {tab === "overrides" && <OverridesSection />}
      {tab === "promotions" && <PromotionsSection />}
      {tab === "referrals" && <ReferralsSection />}
      {tab === "credits" && <CreditsSection />}
    </div>
  );
}

// ---------- Entitlements: feature catalog + package x feature matrix ----------
interface FeatureDef { key: string; label: string; category: string | null; usageLimitType: string; active: boolean }
interface PackageRow { id: string; name: string; packageCode: string }
interface EntitlementRow { packageId: string; featureKey: string; limitValue: number | null; resetPeriod: string | null }

function EntitlementsSection() {
  const { show } = useToast();
  const [features, setFeatures] = useState<FeatureDef[] | null>(null);
  const [packages, setPackages] = useState<PackageRow[] | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [newFeature, setNewFeature] = useState({ key: "", label: "", category: "" });

  const load = () => {
    fetch("/api/admin/membership/entitlement-matrix")
      .then((r) => r.json())
      .then((j) => {
        setPackages(j.packages ?? []);
        setFeatures(j.features ?? []);
        setEntitlements(j.entitlements ?? []);
      });
  };

  useEffect(load, []);

  const cellValue = (packageId: string, featureKey: string) => entitlements.find((e) => e.packageId === packageId && e.featureKey === featureKey)?.limitValue ?? null;

  const setCell = async (packageId: string, featureKey: string, value: string) => {
    const limitValue = value.trim() === "" ? null : Number(value);
    await fetch("/api/admin/membership/entitlement-matrix", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId, featureKey, limitValue }) });
    load();
  };

  const createFeature = async () => {
    if (!newFeature.key.trim() || !newFeature.label.trim()) return;
    const res = await fetch("/api/admin/membership/features", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newFeature) });
    if (res.ok) {
      show("Feature created", "success");
      setNewFeature({ key: "", label: "", category: "" });
      load();
    } else show("Could not create feature", "error");
  };

  if (!features || !packages) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4">
        <h2 className="mb-2 text-sm font-medium">Add Feature</h2>
        <div className="flex flex-wrap gap-2">
          <Input placeholder="FEATURE_KEY" value={newFeature.key} onChange={(e) => setNewFeature({ ...newFeature, key: e.target.value.toUpperCase() })} className="w-48" />
          <Input placeholder="Label" value={newFeature.label} onChange={(e) => setNewFeature({ ...newFeature, label: e.target.value })} className="w-48" />
          <Input placeholder="Category" value={newFeature.category} onChange={(e) => setNewFeature({ ...newFeature, category: e.target.value })} className="w-40" />
          <Button size="sm" onClick={createFeature}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      </div>

      {features.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No features yet" description="Add a feature key above to start building the entitlement matrix." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="p-2 text-left">Feature</th>
                {packages.map((p) => (
                  <th key={p.id} className="p-2 text-left">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {features.map((f) => (
                <tr key={f.key}>
                  <td className="p-2">
                    <div className="font-medium">{f.label}</div>
                    <div className="text-xs text-muted">{f.key} · {formatEnumLabel(f.usageLimitType)}</div>
                  </td>
                  {packages.map((p) => (
                    <td key={p.id} className="p-2">
                      <Input
                        className="w-24"
                        placeholder="Unlimited"
                        defaultValue={cellValue(p.id, f.key) ?? ""}
                        onBlur={(e) => setCell(p.id, f.key, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Overrides ----------
interface OverrideRow { id: string; profileId: string; featureKey: string; overrideType: string; limitValue: number | null; expiresAt: string; reason: string }

function OverridesSection() {
  const { show } = useToast();
  const [items, setItems] = useState<OverrideRow[] | null>(null);
  const [form, setForm] = useState({ profileId: "", featureKey: "", overrideType: "GRANT", limitValue: "", reason: "", expiresAt: "" });

  const load = () => fetch("/api/admin/membership/overrides").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.profileId || !form.featureKey || !form.reason || !form.expiresAt) return show("All fields except limit are required", "error");
    const res = await fetch("/api/admin/membership/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, limitValue: form.limitValue ? Number(form.limitValue) : undefined }),
    });
    const json = await res.json();
    if (res.status === 202) show("Sent for approval", "success");
    else if (res.ok) show("Override granted", "success");
    else show(json.error ?? "Could not grant override", "error");
    load();
  };

  const revoke = async (id: string) => {
    await fetch(`/api/admin/membership/overrides/${id}`, { method: "DELETE" });
    load();
  };

  if (!items) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-2">
        <h2 className="text-sm font-medium">Grant Override</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Input placeholder="Profile ID" value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })} />
          <Input placeholder="Feature key" value={form.featureKey} onChange={(e) => setForm({ ...form, featureKey: e.target.value.toUpperCase() })} />
          <Select value={form.overrideType} onChange={(e) => setForm({ ...form, overrideType: e.target.value })}>
            <option value="GRANT">Grant</option>
            <option value="REVOKE">Revoke</option>
            <option value="LIMIT_ADJUST">Adjust Limit</option>
          </Select>
          <Input placeholder="Limit (optional)" value={form.limitValue} onChange={(e) => setForm({ ...form, limitValue: e.target.value })} />
          <Input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </div>
        <Textarea placeholder="Reason (required)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <Button size="sm" onClick={submit}>Grant</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No overrides" description="Granted entitlement overrides appear here." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <span className="font-medium">{formatEnumLabel(o.overrideType)}</span> — {o.featureKey} — {o.profileId}
                <div className="text-xs text-muted">{o.reason} · expires {formatDateTime(o.expiresAt)}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => revoke(o.id)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Promotions ----------
interface PromotionRow { id: string; name: string; promotionType: string; status: string; promotionCode: string }

function PromotionsSection() {
  const { show } = useToast();
  const [items, setItems] = useState<PromotionRow[] | null>(null);
  const [form, setForm] = useState({ name: "", promotionType: "PACKAGE_DISCOUNT", discountType: "PERCENTAGE", discountValue: "" });

  const load = () => fetch("/api/admin/membership/promotions").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.name.trim()) return show("A name is required", "error");
    const res = await fetch("/api/admin/membership/promotions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, promotionType: form.promotionType, config: { discountType: form.discountType, discountValue: Number(form.discountValue || 0) } }),
    });
    if (res.ok) {
      show("Promotion created (draft)", "success");
      setForm({ name: "", promotionType: "PACKAGE_DISCOUNT", discountType: "PERCENTAGE", discountValue: "" });
      load();
    } else show("Could not create promotion", "error");
  };

  const setStatus = async (id: string, status: string) => {
    const res = await fetch(`/api/admin/membership/promotions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.status === 202) show("Sent for approval", "success");
    load();
  };

  if (!items) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-2">
        <h2 className="text-sm font-medium">Create Promotion</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Select value={form.promotionType} onChange={(e) => setForm({ ...form, promotionType: e.target.value })}>
            <option value="PACKAGE_DISCOUNT">Package Discount</option>
            <option value="TRIAL_EXTENSION">Trial Extension</option>
            <option value="CREDIT_GRANT">Credit Grant</option>
            <option value="FEATURE_UNLOCK">Feature Unlock</option>
          </Select>
          <Select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED_AMOUNT">Fixed Amount</option>
          </Select>
          <Input placeholder="Discount value" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
        </div>
        <Button size="sm" onClick={submit}>Create Draft</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="No promotions" description="Create a promotion above." />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div>
                <span className="font-medium">{p.name}</span> <Badge>{p.status}</Badge>
                <div className="text-xs text-muted">{p.promotionCode} · {formatEnumLabel(p.promotionType)}</div>
              </div>
              <div className="flex gap-2">
                {p.status === "DRAFT" && <Button size="sm" onClick={() => setStatus(p.id, "ACTIVE")}>Activate</Button>}
                {p.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => setStatus(p.id, "PAUSED")}>Pause</Button>}
                {(p.status === "ACTIVE" || p.status === "PAUSED") && <Button size="sm" variant="outline" onClick={() => setStatus(p.id, "ENDED")}>End</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Referrals ----------
interface ReferralRow { id: string; referrerProfileId: string; refereeProfileId: string; status: string; fraudFlags: string[] | null }

function ReferralsSection() {
  const { show } = useToast();
  const [items, setItems] = useState<ReferralRow[] | null>(null);
  const [programForm, setProgramForm] = useState({ name: "", rewardType: "FREE_DAYS", days: "30", qualifyingEvent: "FIRST_PAYMENT" });

  const load = () => fetch("/api/admin/membership/referrals?status=REFERRAL_REVIEW_REQUIRED").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  useEffect(() => { load(); }, []);

  const createProgram = async () => {
    if (!programForm.name.trim()) return show("A name is required", "error");
    const res = await fetch("/api/admin/membership/referrals/programs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: programForm.name, rewardType: programForm.rewardType, rewardConfig: { days: Number(programForm.days) }, qualifyingEvent: programForm.qualifyingEvent }),
    });
    if (res.status === 202) show("Sent for approval", "success");
    else if (res.ok) show("Referral program created (draft)", "success");
    else show("Could not create program", "error");
  };

  const decide = async (id: string, decision: "QUALIFIED" | "REJECTED") => {
    const res = await fetch(`/api/admin/membership/referrals/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    if (res.ok) show(decision === "QUALIFIED" ? "Approved — reward dispatched" : "Rejected", "success");
    load();
  };

  if (!items) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-4 space-y-2">
        <h2 className="text-sm font-medium">Create Referral Program</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Input placeholder="Name" value={programForm.name} onChange={(e) => setProgramForm({ ...programForm, name: e.target.value })} />
          <Select value={programForm.rewardType} onChange={(e) => setProgramForm({ ...programForm, rewardType: e.target.value })}>
            <option value="FREE_DAYS">Free Days</option>
            <option value="CREDIT">Credit</option>
            <option value="FEATURE_UNLOCK">Feature Unlock</option>
            <option value="COUPON">Coupon</option>
            <option value="POINTS">Points</option>
          </Select>
          <Input placeholder="Days" value={programForm.days} onChange={(e) => setProgramForm({ ...programForm, days: e.target.value })} />
          <Select value={programForm.qualifyingEvent} onChange={(e) => setProgramForm({ ...programForm, qualifyingEvent: e.target.value })}>
            <option value="REGISTRATION">Registration</option>
            <option value="FIRST_PAYMENT">First Payment</option>
            <option value="VERIFICATION_COMPLETE">Verification Complete</option>
            <option value="SUBSCRIPTION_ACTIVE_N_DAYS">Active N Days</option>
          </Select>
        </div>
        <Button size="sm" onClick={createProgram}>Create Draft</Button>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Referrals Needing Review</h2>
        {items.length === 0 ? (
          <EmptyState icon={ShieldAlert} title="Nothing to review" description="Referrals flagged for fraud/eligibility review appear here." />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <span className="font-medium">Referral {r.id.slice(0, 8)}</span>
                  <div className="text-xs text-muted">Flags: {(r.fraudFlags ?? []).join(", ") || "none"}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(r.id, "QUALIFIED")}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(r.id, "REJECTED")}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Credits ----------
function CreditsSection() {
  const { show } = useToast();
  const [profileId, setProfileId] = useState("");
  const [items, setItems] = useState<Array<{ id: string; profileId: string; currencyCode: string; balanceMinor: number }> | null>(null);
  const [grant, setGrant] = useState({ currencyCode: "PKR", amountMinor: "", reason: "" });

  const search = () => {
    if (!profileId.trim()) return;
    fetch(`/api/admin/membership/credits?profileId=${encodeURIComponent(profileId.trim())}`).then((r) => r.json()).then((j) => setItems(j.items ?? []));
  };

  const grantCredit = async () => {
    if (!profileId.trim() || !grant.amountMinor || !grant.reason.trim()) return show("Profile, amount, and reason are required", "error");
    const res = await fetch("/api/admin/membership/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: profileId.trim(), currencyCode: grant.currencyCode, amountMinor: Number(grant.amountMinor), reason: grant.reason }),
    });
    if (res.ok) {
      show("Credit granted", "success");
      search();
    } else show("Could not grant credit", "error");
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="Profile ID" value={profileId} onChange={(e) => setProfileId(e.target.value)} />
        <Button size="sm" onClick={search}>Search</Button>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-2">
        <h2 className="text-sm font-medium">Grant Credit</h2>
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Currency (PKR)" value={grant.currencyCode} onChange={(e) => setGrant({ ...grant, currencyCode: e.target.value.toUpperCase() })} />
          <Input placeholder="Amount (minor units)" value={grant.amountMinor} onChange={(e) => setGrant({ ...grant, amountMinor: e.target.value })} />
          <Input placeholder="Reason" value={grant.reason} onChange={(e) => setGrant({ ...grant, reason: e.target.value })} />
        </div>
        <Button size="sm" onClick={grantCredit}>Grant</Button>
      </div>

      {items && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.length === 0 ? <li className="p-3 text-sm text-muted">No credit balance found.</li> : items.map((c) => (
            <li key={c.id} className="p-3 text-sm">{c.profileId} — {formatMoney(c.balanceMinor, c.currencyCode)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
