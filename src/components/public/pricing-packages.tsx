import Link from "next/link";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance/money";
import { formatEnumLabel } from "@/lib/utils";
import { billingPeriodLabel, priceLabel } from "@/lib/public-site/pricing-display";
import type { PublicPackage } from "@/lib/public-site/packages";

// Public package comparison, rendered on the server so it is in the page HTML for visitors and search engines. Everything shown (name, price,
// currency, billing period, trial, features) comes from the package configuration; nothing is hard-coded, so a price change in the admin area
// appears here without a release.
export function PricingPackages({ packages }: { packages: PublicPackage[] }) {
  if (packages.length === 0) return <p className="text-center text-sm text-muted">No packages are currently available.</p>;

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {packages.map((p) => {
        const price = priceLabel(p.price, formatMoney);
        return (
          <Card key={p.id} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col space-y-3">
              <div>
                <h2 className="font-heading text-lg font-semibold">{p.name}</h2>
                <p className="text-xs text-muted">{billingPeriodLabel(p.billingType, p.durationDays)}</p>
              </div>
              <p className="text-2xl font-semibold">
                {price.text}
                {price.isFree && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 align-middle text-xs font-medium text-muted">Free</span>}
              </p>
              <p className="text-sm text-muted">{p.description}</p>
              {p.trialDays > 0 && <p className="text-xs text-primary">{p.trialDays}-day trial included</p>}
              <ul className="flex-1 space-y-1 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>{formatEnumLabel(f)}</span>
                  </li>
                ))}
              </ul>
              <Link href="/my-billing" className={buttonClass({ variant: "outline", className: "w-full" })}>
                View available features
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
