"use client";

import { useEffect, useState } from "react";
import { Loader2, DollarSign, TrendingUp, CheckCircle2, Clock, XCircle, RotateCcw, Users, AlertTriangle, Landmark, Trash2 } from "lucide-react";
import { StatCard } from "@/components/admin/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, formatEnumLabel } from "@/lib/utils";
import { formatMoney } from "@/lib/finance/money";

interface Kpis {
  grossRevenueMinor: number;
  netRevenueMinor: number;
  successfulPayments: number;
  pendingPayments: number;
  failedPayments: number;
  refundsMinor: number;
  refundCount: number;
  activeSubscriptions: number;
  expiringSubscriptions: number;
  cancelledSubscriptions: number;
  outstandingAmountMinor: number;
  averageTransactionValueMinor: number;
}

const TABS = [
  { value: "payments", label: "Payments" },
  { value: "orders", label: "Orders" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "invoices", label: "Invoices" },
  { value: "refunds", label: "Refunds" },
  { value: "manual-payments", label: "Manual Payment Queue" },
  { value: "coupons", label: "Coupons" },
  { value: "bank-accounts", label: "Bank Accounts" },
  { value: "reconciliation", label: "Reconciliation" },
];

export default function FinanceCenterPage() {
  const { show } = useToast();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [tab, setTab] = useState("payments");

  useEffect(() => {
    fetch("/api/admin/finance-center/kpis").then((r) => r.json()).then(setKpis).catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Finance Center</h1>
        <p className="text-sm text-muted">Payments, subscriptions, invoices, refunds, and financial configuration — centralized and audited.</p>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={DollarSign} label="Gross Revenue" value={formatMoney(kpis.grossRevenueMinor, "PKR")} />
          <StatCard icon={TrendingUp} label="Net Revenue" value={formatMoney(kpis.netRevenueMinor, "PKR")} accent="success" />
          <StatCard icon={CheckCircle2} label="Successful Payments" value={kpis.successfulPayments} accent="success" />
          <StatCard icon={Clock} label="Pending Payments" value={kpis.pendingPayments} accent="warning" />
          <StatCard icon={XCircle} label="Failed Payments" value={kpis.failedPayments} accent={kpis.failedPayments > 0 ? "danger" : "success"} />
          <StatCard icon={RotateCcw} label="Refunds" value={`${kpis.refundCount} (${formatMoney(kpis.refundsMinor, "PKR")})`} />
          <StatCard icon={Users} label="Active Subscriptions" value={kpis.activeSubscriptions} />
          <StatCard icon={AlertTriangle} label="Expiring Soon" value={kpis.expiringSubscriptions} accent={kpis.expiringSubscriptions > 0 ? "warning" : "success"} />
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "payments" && <PaymentsSection />}
      {tab === "orders" && <OrdersSection />}
      {tab === "subscriptions" && <SubscriptionsSection />}
      {tab === "invoices" && <InvoicesSection />}
      {tab === "refunds" && <RefundsSection onChanged={() => show("Updated", "success")} />}
      {tab === "manual-payments" && <ManualPaymentsSection onChanged={() => show("Updated", "success")} />}
      {tab === "coupons" && <CouponsSection onChanged={() => show("Saved", "success")} />}
      {tab === "bank-accounts" && <BankAccountsSection onChanged={() => show("Saved", "success")} />}
      {tab === "reconciliation" && <ReconciliationSection onChanged={() => show("Reconciliation run started", "success")} />}
    </div>
  );
}

function PaymentsSection() {
  const [items, setItems] = useState<Array<{ id: string; paymentCode: string; profile: { fullName: string; profileCode: string }; orderCode: string; amountMinor: number; currencyCode: string; method: string; status: string; createdAt: string }> | null>(null);

  useEffect(() => {
    fetch("/api/admin/finance-center/payments").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={DollarSign} title="No payments yet" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Payment</th><th className="p-3">Customer</th><th className="p-3">Order</th><th className="p-3">Amount</th><th className="p-3">Method</th><th className="p-3">Status</th><th className="p-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-border last:border-0">
              <td className="p-3 font-mono text-xs">{p.paymentCode}</td>
              <td className="p-3">{p.profile.fullName} <span className="text-muted">({p.profile.profileCode})</span></td>
              <td className="p-3 font-mono text-xs text-muted">{p.orderCode}</td>
              <td className="p-3">{formatMoney(p.amountMinor, p.currencyCode)}</td>
              <td className="p-3 text-muted">{formatEnumLabel(p.method)}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(p.status)}</Badge></td>
              <td className="p-3 text-muted">{formatDate(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrdersSection() {
  const [items, setItems] = useState<Array<{ id: string; orderCode: string; profile: { fullName: string; profileCode: string }; totalMinor: number; currencyCode: string; status: string; createdAt: string; items: Array<{ package: { name: string } }> }> | null>(null);

  useEffect(() => {
    fetch("/api/admin/finance-center/orders").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={DollarSign} title="No orders yet" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Order</th><th className="p-3">Customer</th><th className="p-3">Package</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id} className="border-b border-border last:border-0">
              <td className="p-3 font-mono text-xs">{o.orderCode}</td>
              <td className="p-3">{o.profile.fullName} <span className="text-muted">({o.profile.profileCode})</span></td>
              <td className="p-3 text-muted">{o.items[0]?.package.name ?? "—"}</td>
              <td className="p-3">{formatMoney(o.totalMinor, o.currencyCode)}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(o.status)}</Badge></td>
              <td className="p-3 text-muted">{formatDate(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubscriptionsSection() {
  const [items, setItems] = useState<Array<{ id: string; subscriptionCode: string; profile: { fullName: string; profileCode: string }; package: { name: string }; status: string; startDate: string | null; endDate: string | null }> | null>(null);

  useEffect(() => {
    fetch("/api/admin/finance-center/subscriptions").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={Users} title="No subscriptions yet" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Subscription</th><th className="p-3">Customer</th><th className="p-3">Package</th><th className="p-3">Status</th><th className="p-3">Start</th><th className="p-3">End</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-b border-border last:border-0">
              <td className="p-3 font-mono text-xs">{s.subscriptionCode}</td>
              <td className="p-3">{s.profile.fullName} <span className="text-muted">({s.profile.profileCode})</span></td>
              <td className="p-3 text-muted">{s.package.name}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(s.status)}</Badge></td>
              <td className="p-3 text-muted">{s.startDate ? formatDate(s.startDate) : "—"}</td>
              <td className="p-3 text-muted">{s.endDate ? formatDate(s.endDate) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesSection() {
  const [items, setItems] = useState<Array<{ id: string; invoiceCode: string; profile: { fullName: string; profileCode: string }; totalMinor: number; currencyCode: string; paymentStatus: string; invoiceDate: string }> | null>(null);

  useEffect(() => {
    fetch("/api/admin/finance-center/invoices").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }, []);

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={DollarSign} title="No invoices yet" />;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="p-3">Invoice</th><th className="p-3">Customer</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-border last:border-0">
              <td className="p-3 font-mono text-xs">{i.invoiceCode}</td>
              <td className="p-3">{i.profile.fullName} <span className="text-muted">({i.profile.profileCode})</span></td>
              <td className="p-3">{formatMoney(i.totalMinor, i.currencyCode)}</td>
              <td className="p-3"><Badge variant="muted">{formatEnumLabel(i.paymentStatus)}</Badge></td>
              <td className="p-3 text-muted">{formatDate(i.invoiceDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RefundsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; refundCode: string; payment: { profile: { fullName: string; profileCode: string } }; amountMinor: number; currencyCode: string; status: string; reason: string }> | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  function load() {
    fetch("/api/admin/finance-center/refunds").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function approve(id: string) {
    const res = await fetch(`/api/admin/finance-center/refunds/${id}/approve`, { method: "POST" });
    if (res.ok) { onChanged(); load(); }
  }
  async function reject(id: string) {
    const res = await fetch(`/api/admin/finance-center/refunds/${id}/reject`, { method: "POST" });
    if (res.ok) { onChanged(); load(); }
  }
  async function execute() {
    if (!executing) return;
    const reauth = await fetch("/api/admin/auth/reauth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const reauthJson = await reauth.json();
    if (!reauth.ok) return;
    const res = await fetch(`/api/admin/finance-center/refunds/${executing}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reauthToken: reauthJson.token }) });
    if (res.ok) { onChanged(); setExecuting(null); setPassword(""); load(); }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={RotateCcw} title="No refunds" />;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="p-3">Refund</th><th className="p-3">Customer</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="p-3 font-mono text-xs">{r.refundCode}</td>
                <td className="p-3">{r.payment.profile.fullName} <span className="text-muted">({r.payment.profile.profileCode})</span></td>
                <td className="p-3">{formatMoney(r.amountMinor, r.currencyCode)}</td>
                <td className="p-3"><Badge variant="muted">{formatEnumLabel(r.status)}</Badge></td>
                <td className="p-3 space-x-2">
                  {r.status === "REQUESTED" && <Button size="sm" variant="outline" onClick={() => approve(r.id)}>Approve</Button>}
                  {(r.status === "REQUESTED" || r.status === "PENDING_APPROVAL") && <Button size="sm" variant="outline" onClick={() => reject(r.id)}>Reject</Button>}
                  {r.status === "APPROVED" && <Button size="sm" onClick={() => setExecuting(r.id)}>Execute Refund</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog open={!!executing} title="Execute Refund" description="This is a high-risk financial action requiring password re-confirmation." danger confirmLabel="Execute" onConfirm={execute} onCancel={() => setExecuting(null)}>
        <Field label="Confirm your password" htmlFor="refund-password">
          <Input id="refund-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function ManualPaymentsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; paymentId: string; referenceNumber: string; payment: { profile: { fullName: string; profileCode: string }; order: { orderCode: string; totalMinor: number; currencyCode: string } } }> | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function load() {
    fetch("/api/admin/finance-center/manual-payments").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function verify(paymentId: string) {
    const res = await fetch(`/api/admin/finance-center/manual-payments/${paymentId}/verify`, { method: "POST" });
    if (res.ok) { onChanged(); load(); }
  }
  async function reject() {
    if (!rejecting) return;
    const res = await fetch(`/api/admin/finance-center/manual-payments/${rejecting}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rejectionReason: reason }) });
    if (res.ok) { onChanged(); setRejecting(null); setReason(""); load(); }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  if (items.length === 0) return <EmptyState icon={CheckCircle2} title="No manual payments pending verification" />;

  return (
    <>
      <div className="space-y-2">
        {items.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
            <div>
              <p className="font-medium">{m.payment.profile.fullName} ({m.payment.profile.profileCode})</p>
              <p className="text-xs text-muted">Order {m.payment.order.orderCode} — {formatMoney(m.payment.order.totalMinor, m.payment.order.currencyCode)} — Ref: {m.referenceNumber}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => verify(m.paymentId)}>Verify</Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(m.paymentId)}>Reject</Button>
            </div>
          </div>
        ))}
      </div>
      <ConfirmDialog open={!!rejecting} title="Reject Manual Payment" description="A rejection reason is required." confirmLabel="Reject" danger confirmDisabled={!reason.trim()} onConfirm={reject} onCancel={() => setRejecting(null)}>
        <Field label="Rejection Reason" htmlFor="manual-reject-reason">
          <Textarea id="manual-reject-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

function CouponsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; discountCode: string; code: string; discountType: string; discountValue: number; active: boolean; usageLimit: number | null }> | null>(null);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("10");

  function load() {
    fetch("/api/admin/finance-center/coupons").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function create() {
    const res = await fetch("/api/admin/finance-center/coupons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, discountType, discountValue: Number(discountValue) }) });
    if (res.ok) { onChanged(); setCreating(false); setCode(""); load(); }
  }
  async function toggle(id: string, active: boolean) {
    const res = await fetch(`/api/admin/finance-center/coupons/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) });
    if (res.ok) { onChanged(); load(); }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>Create Coupon</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={DollarSign} title="No coupons yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Code</th><th className="p-3">Discount</th><th className="p-3">Usage Limit</th><th className="p-3">Status</th><th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{c.code}</td>
                  <td className="p-3">{c.discountType === "PERCENTAGE" ? `${c.discountValue}%` : formatMoney(c.discountValue, "PKR")}</td>
                  <td className="p-3 text-muted">{c.usageLimit ?? "Unlimited"}</td>
                  <td className="p-3"><Badge variant={c.active ? "success" : "muted"}>{c.active ? "Active" : "Disabled"}</Badge></td>
                  <td className="p-3"><Button size="sm" variant="outline" onClick={() => toggle(c.id, c.active)}>{c.active ? "Disable" : "Enable"}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog open={creating} title="Create Coupon" description="The coupon code is what customers enter at checkout." confirmLabel="Create" onConfirm={create} onCancel={() => setCreating(false)}>
        <Field label="Coupon Code" htmlFor="coupon-code">
          <Input id="coupon-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
        </Field>
        <Field label="Discount Type" htmlFor="coupon-type">
          <Select id="coupon-type" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
            <option value="PERCENTAGE">Percentage</option>
            <option value="FIXED_AMOUNT">Fixed Amount (minor units)</option>
          </Select>
        </Field>
        <Field label="Discount Value" htmlFor="coupon-value">
          <Input id="coupon-value" type="number" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function BankAccountsSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Array<{ id: string; accountTitle: string; accountNumber: string; bankName: string; branchName: string | null; iban: string | null; active: boolean }> | null>(null);
  const [creating, setCreating] = useState(false);
  const [accountTitle, setAccountTitle] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [iban, setIban] = useState("");

  function load() {
    fetch("/api/admin/finance-center/bank-accounts").then((r) => r.json()).then((j) => setItems(j.items ?? []));
  }
  useEffect(load, []);

  async function create() {
    const res = await fetch("/api/admin/finance-center/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountTitle, accountNumber, bankName, branchName: branchName || undefined, iban: iban || undefined }),
    });
    if (res.ok) {
      onChanged();
      setCreating(false);
      setAccountTitle("");
      setAccountNumber("");
      setBankName("");
      setBranchName("");
      setIban("");
      load();
    }
  }

  async function toggle(id: string, active: boolean) {
    const res = await fetch(`/api/admin/finance-center/bank-accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !active }) });
    if (res.ok) { onChanged(); load(); }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/finance-center/bank-accounts/${id}`, { method: "DELETE" });
    if (res.ok) { onChanged(); load(); }
  }

  if (items === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">These accounts are shown to customers during Manual/Bank Transfer checkout. At least one active account is required for Manual payments to work.</p>
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>Add Bank Account</Button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Landmark} title="No bank accounts configured" description="Customers won't see any transfer destination until you add one." />
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="font-medium">{a.bankName} — {a.accountTitle}</p>
                <p className="text-xs text-muted">Acc# {a.accountNumber}{a.iban ? ` · IBAN ${a.iban}` : ""}{a.branchName ? ` · ${a.branchName}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={a.active ? "success" : "muted"}>{a.active ? "Active" : "Disabled"}</Badge>
                <Button size="sm" variant="outline" onClick={() => toggle(a.id, a.active)}>{a.active ? "Disable" : "Enable"}</Button>
                <Button size="sm" variant="outline" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog open={creating} title="Add Bank Account" description="Shown to customers during checkout for Manual/Bank Transfer payments." confirmLabel="Add" confirmDisabled={!accountTitle.trim() || !accountNumber.trim() || !bankName.trim()} onConfirm={create} onCancel={() => setCreating(false)}>
        <Field label="Bank Name" htmlFor="ba-bank">
          <Input id="ba-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
        </Field>
        <Field label="Account Title" htmlFor="ba-title">
          <Input id="ba-title" value={accountTitle} onChange={(e) => setAccountTitle(e.target.value)} />
        </Field>
        <Field label="Account Number" htmlFor="ba-number">
          <Input id="ba-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
        </Field>
        <Field label="IBAN (optional)" htmlFor="ba-iban">
          <Input id="ba-iban" value={iban} onChange={(e) => setIban(e.target.value)} />
        </Field>
        <Field label="Branch (optional)" htmlFor="ba-branch">
          <Input id="ba-branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function ReconciliationSection({ onChanged }: { onChanged: () => void }) {
  const [runs, setRuns] = useState<Array<{ id: string; startedAt: string; completedAt: string | null; totalChecked: number; matchedCount: number; discrepancyCount: number; startedBy: { name: string } }> | null>(null);
  const [running, setRunning] = useState(false);

  function load() {
    fetch("/api/admin/finance-center/reconciliation").then((r) => r.json()).then((j) => setRuns(j.items ?? []));
  }
  useEffect(load, []);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/finance-center/reconciliation/run", { method: "POST" });
      if (res.ok) { onChanged(); load(); }
    } finally {
      setRunning(false);
    }
  }

  if (runs === null) return <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={run} disabled={running}>{running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run Reconciliation"}</Button>
      </div>
      {runs.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No reconciliation runs yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Started</th><th className="p-3">By</th><th className="p-3">Checked</th><th className="p-3">Matched</th><th className="p-3">Discrepancies</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="p-3 text-muted">{formatDateTime(r.startedAt)}</td>
                  <td className="p-3">{r.startedBy.name}</td>
                  <td className="p-3">{r.totalChecked}</td>
                  <td className="p-3 text-success">{r.matchedCount}</td>
                  <td className="p-3"><Badge variant={r.discrepancyCount > 0 ? "warning" : "success"}>{r.discrepancyCount}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
