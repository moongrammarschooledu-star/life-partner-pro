"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { StatCard } from "@/components/admin/stat-card";
import { formatEnumLabel } from "@/lib/utils";
import { formatMoney } from "@/lib/finance/money";
import { DollarSign, TrendingUp, Users, XCircle, RotateCcw, Ticket } from "lucide-react";

interface FinanceReportData {
  grossRevenueMinor: number;
  netRevenueMinor: number;
  revenueByMethod: { label: string; sumMinor: number; count: number }[];
  revenueByProvider: { label: string; sumMinor: number }[];
  paymentsByStatus: { label: string; count: number }[];
  refundsByStatus: { label: string; count: number; sumMinor: number }[];
  newSubscriptions: number;
  cancelledSubscriptions: number;
  failedPayments: number;
  couponRedemptions: number;
}

// Spec §33 — real numbers only, aggregate sums never row-level identity,
// mirroring the Cases/Privacy report tabs' own precedent exactly.
export function FinanceSection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<FinanceReportData>("/api/admin/reports/finance", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard icon={DollarSign} label="Gross Revenue" value={formatMoney(data.grossRevenueMinor, "PKR")} />
            <StatCard icon={TrendingUp} label="Net Revenue" value={formatMoney(data.netRevenueMinor, "PKR")} accent="success" />
            <StatCard icon={Users} label="New Subscriptions" value={data.newSubscriptions} />
            <StatCard icon={XCircle} label="Failed Payments" value={data.failedPayments} accent={data.failedPayments > 0 ? "danger" : "success"} />
            <StatCard icon={RotateCcw} label="Cancelled Subscriptions" value={data.cancelledSubscriptions} />
            <StatCard icon={Ticket} label="Coupon Redemptions" value={data.couponRedemptions} />
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Payments by Status" data={data.paymentsByStatus.map((p) => ({ label: formatEnumLabel(p.label), count: p.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Revenue by Method (count)" data={data.revenueByMethod.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Refunds by Status" data={data.refundsByStatus.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
          </div>
        </div>
      )}
    </SectionShell>
  );
}
