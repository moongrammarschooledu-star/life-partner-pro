"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatEnumLabel } from "@/lib/utils";
import { formatMoney } from "@/lib/finance/money";

interface InvoiceRow {
  id: string;
  invoiceCode: string;
  totalMinor: number;
  currencyCode: string;
  paymentStatus: string;
  invoiceDate: string;
}

export default function MyInvoicesPage() {
  const [items, setItems] = useState<InvoiceRow[] | null>(null);

  useEffect(() => {
    fetch("/api/my-billing/invoices").then((r) => (r.ok ? r.json() : { items: [] })).then((j) => setItems(j.items ?? []));
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Link href="/my-billing" className="text-sm text-muted hover:text-foreground">&larr; Back to Packages &amp; Billing</Link>
      <h1 className="mt-2 font-heading text-2xl font-semibold">My Invoices</h1>

      {items === null ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <div className="mt-6"><EmptyState icon={Download} title="No invoices yet" /></div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="font-mono text-xs">{inv.invoiceCode}</p>
                <p className="text-muted">{formatDate(inv.invoiceDate)} · {formatMoney(inv.totalMinor, inv.currencyCode)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="muted">{formatEnumLabel(inv.paymentStatus)}</Badge>
                <a href={`/api/my-billing/invoices/${inv.id}/download`} className="text-primary hover:underline">
                  <Download className="h-4 w-4" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
