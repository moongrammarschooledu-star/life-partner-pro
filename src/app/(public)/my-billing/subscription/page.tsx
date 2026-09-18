"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, PauseCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatEnumLabel } from "@/lib/utils";

interface SubscriptionData {
  subscriptionCode: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  autoRenew: boolean;
  package: { name: string; billingType: string };
  usage: { featureKey: string; limitValue: number | null; remaining: number | null }[];
}

export default function MySubscriptionPage() {
  const { show } = useToast();
  const [data, setData] = useState<SubscriptionData | null | undefined>(undefined);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    fetch("/api/my-billing/subscription").then((r) => (r.ok ? r.json() : { subscription: null })).then((j) => setData(j.subscription));
  }
  useEffect(load, []);

  async function cancel() {
    const res = await fetch("/api/my-billing/subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Cancelled by user", immediate: false }) });
    if (res.ok) {
      show("Subscription cancelled.", "success");
      setCancelling(false);
      load();
    }
  }

  if (data === undefined) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/my-billing" className="text-sm text-muted hover:text-foreground">&larr; Back to Packages &amp; Billing</Link>
      <h1 className="mt-2 font-heading text-2xl font-semibold">My Subscription</h1>

      {!data ? (
        <Card className="mt-4">
          <CardContent>
            <p className="text-sm text-muted">You don&apos;t have an active subscription. <Link href="/my-billing" className="text-primary hover:underline">Browse packages</Link>.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-4">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-semibold">{data.package.name}</h2>
              <Badge variant="muted">{formatEnumLabel(data.status)}</Badge>
            </div>
            <p className="font-mono text-xs text-muted">{data.subscriptionCode}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><span className="text-muted">Started:</span> {data.startDate ? formatDate(data.startDate) : "—"}</p>
              <p><span className="text-muted">Renews:</span> {data.renewalDate ? formatDate(data.renewalDate) : "—"}</p>
              <p><span className="text-muted">Billing:</span> {formatEnumLabel(data.package.billingType)}</p>
              <p><span className="text-muted">Auto-Renew:</span> {data.autoRenew ? "Yes" : "No"}</p>
            </div>

            {data.usage.length > 0 && (
              <div className="space-y-1 pt-2">
                <p className="text-sm font-medium">Usage</p>
                {data.usage.map((u) => (
                  <div key={u.featureKey} className="flex items-center justify-between text-sm">
                    <span className="text-muted">{u.featureKey}</span>
                    <span>{u.remaining == null ? "Unlimited" : `${u.remaining} remaining`}</span>
                  </div>
                ))}
              </div>
            )}

            <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
              <PauseCircle className="h-4 w-4" /> Cancel Subscription
            </Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={cancelling}
        title="Cancel Subscription"
        description="Your subscription will be cancelled at the end of the current billing period. This does not delete your matrimonial profile."
        danger
        confirmLabel="Cancel Subscription"
        onConfirm={cancel}
        onCancel={() => setCancelling(false)}
      />
    </div>
  );
}
