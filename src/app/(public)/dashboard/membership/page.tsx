"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Gift, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatEnumLabel, formatDateTime } from "@/lib/utils";
import { formatMoney } from "@/lib/finance/money";

interface UsageItem { featureKey: string; limitValue: number | null; allowed: boolean; state: string; remaining: number | null; source: string }
interface OverrideItem { featureKey: string; overrideType: string; limitValue: number | null; expiresAt: string; reason: string }
interface MembershipData {
  subscription: { subscriptionCode: string; status: string; startDate: string | null; endDate: string | null; renewalDate: string | null; autoRenew: boolean; trialEndsAt: string | null; package: { name: string; packageType: string; billingType: string } } | null;
  usage: UsageItem[];
  overrides: OverrideItem[];
  credit: { balanceMinor: number; currencyCode: string };
  referral: { totalReferred: number; qualified: number; rewarded: number; pendingRewardValue: number };
}

// STEP 27 §62 — current plan, usage, entitlements, credits, and a referral
// summary in one place. Every number here comes from a server response
// (never a frontend-only counter).
export default function MembershipPage() {
  const [data, setData] = useState<MembershipData | null>(null);

  useEffect(() => {
    fetch("/api/my-membership").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  if (!data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-16 sm:px-6">
      <div>
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold">Membership</h1>
        <p className="mt-1 text-sm text-muted">Your current plan, feature usage, and rewards.</p>
      </div>

      <Card>
        <CardContent className="space-y-2">
          <h2 className="font-medium">Current Plan</h2>
          {data.subscription ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{data.subscription.package.name}</span>
                <StatusBadge status={data.subscription.status} />
              </div>
              <p className="text-xs text-muted">{formatEnumLabel(data.subscription.package.packageType)} · {formatEnumLabel(data.subscription.package.billingType)}</p>
              {data.subscription.trialEndsAt && <p className="text-xs text-muted">Trial ends {formatDateTime(data.subscription.trialEndsAt)}</p>}
              {data.subscription.renewalDate && <p className="text-xs text-muted">Renews {formatDateTime(data.subscription.renewalDate)}</p>}
              <div className="flex gap-2 pt-2">
                <Link href="/my-billing"><Button size="sm" variant="outline">Manage Plan</Button></Link>
                <Link href="/pricing"><Button size="sm" variant="outline">Compare Packages</Button></Link>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">You&apos;re on the Free plan.</p>
              <Link href="/pricing"><Button size="sm">View Packages</Button></Link>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2">
          <h2 className="font-medium">Feature Usage</h2>
          {data.usage.length === 0 ? (
            <p className="text-sm text-muted">No metered features on your current plan.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.usage.map((u) => (
                <li key={u.featureKey} className="flex items-center justify-between py-2 text-sm">
                  <span>{formatEnumLabel(u.featureKey)}</span>
                  <span className="text-xs text-muted">
                    {u.remaining == null ? "Unlimited" : `${u.remaining} left`} <StatusBadge status={u.state} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {data.overrides.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="font-medium">Special Access</h2>
            {data.overrides.map((o, i) => (
              <p key={i} className="text-sm">{formatEnumLabel(o.featureKey)} — {formatEnumLabel(o.overrideType)} until {formatDateTime(o.expiresAt)}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium"><Wallet className="h-4 w-4" /> Credit Balance</div>
            <p className="text-lg font-semibold">{formatMoney(data.credit.balanceMinor, data.credit.currencyCode)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium"><Gift className="h-4 w-4" /> Referrals</div>
            <p className="text-lg font-semibold">{data.referral.rewarded} rewarded</p>
            <Link href="/dashboard/referrals" className="text-xs text-primary hover:underline">View referral program</Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
