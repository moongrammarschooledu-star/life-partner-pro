"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search, CreditCard, CheckCircle2, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatMoney } from "@/lib/finance/money";

interface PackageOption {
  id: string;
  packageCode: string;
  name: string;
  description: string;
  billingType: string;
  price: { amountMinor: number; currencyCode: string } | null;
  features: string[];
}

export default function MyBillingPage() {
  const { show } = useToast();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [profileCode, setProfileCode] = useState("");
  const [email, setEmail] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [packages, setPackages] = useState<PackageOption[] | null>(null);
  const [selected, setSelected] = useState<PackageOption | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [checkoutResult, setCheckoutResult] = useState<{ orderCode: string; paymentCode: string; instructions: string | null; paymentId?: string } | null>(null);
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/my-status").then((r) => setSignedIn(r.ok));
    fetch("/api/my-billing/packages").then((r) => r.json()).then((j) => setPackages(j.items ?? []));
  }, []);

  async function lookup() {
    setLookingUp(true);
    try {
      const res = await fetch("/api/my-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileCode, email }) });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Profile not found.", "error"); return; }
      setSignedIn(true);
    } finally {
      setLookingUp(false);
    }
  }

  async function checkout() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/my-billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: selected.id, couponCode: couponCode || undefined }) });
      const json = await res.json();
      if (!res.ok) { show(json.error ?? "Could not start checkout.", "error"); return; }
      setCheckoutResult(json);
    } finally {
      setSubmitting(false);
    }
  }

  if (signedIn === null || packages === null) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Packages &amp; Billing</h1>
        <p className="mt-2 text-sm text-muted">Enter your Profile ID and the email you registered with to continue.</p>
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

  if (checkoutResult) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <h1 className="font-heading text-2xl font-semibold">Complete Your Payment</h1>
        <Card className="mt-4">
          <CardContent className="space-y-3">
            <p className="text-sm text-muted">Order {checkoutResult.orderCode}</p>
            <pre className="whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm">{checkoutResult.instructions}</pre>
            <Field label="Your Payment Reference" htmlFor="ref" hint="Enter the reference number from your bank transfer receipt.">
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Button
              onClick={async () => {
                const res = await fetch(`/api/my-billing/payments/${checkoutResult.paymentId}/confirm`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ referenceNumber: reference }),
                });
                if (res.ok) show("Submitted for verification. We'll notify you once confirmed.", "success");
                else show((await res.json()).error ?? "Could not submit.", "error");
              }}
              disabled={!reference.trim()}
            >
              <CheckCircle2 className="h-4 w-4" /> I&apos;ve Made the Transfer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
      <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold">Packages &amp; Billing</h1>
        <p className="text-sm text-muted">
          Optional premium services — everything else on Life Partner Pro remains free.{" "}
          <Link href="/my-billing/subscription" className="text-primary hover:underline">My Subscription</Link>
          {" · "}
          <Link href="/my-billing/invoices" className="text-primary hover:underline">My Invoices</Link>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packages.map((p) => (
          <Card key={p.id}>
            <CardContent className="space-y-2">
              <h3 className="font-heading font-semibold">{p.name}</h3>
              <p className="text-sm text-muted">{p.description}</p>
              <p className="text-xl font-semibold">{p.price ? formatMoney(p.price.amountMinor, p.price.currencyCode) : "Contact us"}</p>
              <Button size="sm" className="w-full" onClick={() => setSelected(p)}>
                <CreditCard className="h-4 w-4" /> Select
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {selected && (
        <Card className="mt-4">
          <CardContent className="space-y-3">
            <h3 className="font-heading font-semibold">Checkout: {selected.name}</h3>
            <p className="text-lg">{selected.price ? formatMoney(selected.price.amountMinor, selected.price.currencyCode) : ""}</p>
            <Field label="Coupon Code (optional)" htmlFor="coupon">
              <Input id="coupon" value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} />
            </Field>
            <Button onClick={checkout} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Confirm Purchase
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
