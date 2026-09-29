"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/finance/money";
import { formatEnumLabel } from "@/lib/utils";

interface PackageItem {
  id: string;
  name: string;
  description: string;
  billingType: string;
  trialDays: number;
  price: { amountMinor: number; currencyCode: string } | null;
  features: string[];
}

// STEP 27 §24 — public, unauthenticated package comparison. Reuses the
// existing public /api/my-billing/packages endpoint (STEP 14) rather than
// standing up a second, duplicate package-listing route. No guarantees
// about matrimonial outcomes are ever stated here (spec's absolute rule).
export default function PricingPage() {
  const [packages, setPackages] = useState<PackageItem[] | null>(null);

  useEffect(() => {
    fetch("/api/my-billing/packages").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setPackages(j.items ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-16 sm:px-6">
      <div className="text-center">
        <h1 className="font-heading text-3xl font-semibold">Packages</h1>
        <p className="mt-2 text-muted">Choose the package that fits your search. Features and limits are configured by our team and may change over time.</p>
      </div>

      {!packages ? (
        <p className="text-center text-sm text-muted">Loading...</p>
      ) : packages.length === 0 ? (
        <p className="text-center text-sm text-muted">No packages are currently available.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => (
            <Card key={p.id} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col space-y-3">
                <div>
                  <h2 className="font-heading text-lg font-semibold">{p.name}</h2>
                  <p className="text-xs text-muted">{formatEnumLabel(p.billingType)}</p>
                </div>
                <p className="text-2xl font-semibold">{p.price ? formatMoney(p.price.amountMinor, p.price.currencyCode) : "Contact us"}</p>
                <p className="text-sm text-muted">{p.description}</p>
                {p.trialDays > 0 && <p className="text-xs text-primary">{p.trialDays}-day trial included</p>}
                <ul className="flex-1 space-y-1 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                      <span>{formatEnumLabel(f)}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/my-billing"><Button className="w-full">Choose Package</Button></Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-center text-xs text-muted">Packages provide configured features and services. They do not guarantee a match, a response, or a marriage outcome.</p>
    </div>
  );
}
