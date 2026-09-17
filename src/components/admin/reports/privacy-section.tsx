"use client";

import { useReportSection } from "@/components/admin/reports/use-report-section";
import { SectionShell } from "@/components/admin/reports/section-shell";
import { BarChart } from "@/components/admin/bar-chart";
import { StatCard } from "@/components/admin/stat-card";
import { formatEnumLabel } from "@/lib/utils";
import { ShieldCheck, ShieldOff, FileText, Lock, Eye, Phone, AlertTriangle } from "lucide-react";

interface PrivacyReportData {
  consentGrants: number;
  consentRevocations: number;
  privacyRequestsByType: { label: string; count: number }[];
  deletionRequestsByStatus: { label: string; count: number }[];
  retentionActionsByOutcome: { label: string; count: number }[];
  activeHolds: number;
  sensitiveAccessCount: number;
  contactSharingEvents: number;
  incidentsByCategory: { label: string; count: number }[];
  exportsByStatus: { label: string; count: number }[];
}

// Spec §47 — real numbers only, counts/rates never row-level identity,
// mirroring the Cases report tab's own precedent exactly.
export function PrivacySection({ queryString, enabled }: { queryString: string; enabled: boolean }) {
  const { data, loading, error } = useReportSection<PrivacyReportData>("/api/admin/reports/privacy", queryString, enabled);

  return (
    <SectionShell loading={loading} error={error} isEmpty={!data}>
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard icon={ShieldCheck} label="Consent Grants" value={data.consentGrants} accent="success" />
            <StatCard icon={ShieldOff} label="Consent Revocations" value={data.consentRevocations} />
            <StatCard icon={Lock} label="Active Legal Holds" value={data.activeHolds} />
            <StatCard icon={Eye} label="Sensitive Access Events" value={data.sensitiveAccessCount} />
            <StatCard icon={Phone} label="Contact Sharing Events" value={data.contactSharingEvents} />
            <StatCard icon={AlertTriangle} label="Privacy Incidents" value={data.incidentsByCategory.reduce((sum, i) => sum + i.count, 0)} accent={data.incidentsByCategory.length > 0 ? "warning" : "success"} />
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Privacy Requests by Type" data={data.privacyRequestsByType.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Deletion Requests by Status" data={data.deletionRequestsByStatus.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Retention Actions by Outcome" data={data.retentionActionsByOutcome.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-4">
            <BarChart title="Data Exports by Status" data={data.exportsByStatus.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
          </div>
          {data.incidentsByCategory.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <BarChart title="Privacy Incidents by Category" data={data.incidentsByCategory.map((r) => ({ label: formatEnumLabel(r.label), count: r.count }))} />
            </div>
          )}
          <div className="flex items-center gap-2 text-xs text-muted">
            <FileText className="h-3.5 w-3.5" /> Aggregate counts only — never individual reporter/requester identity.
          </div>
        </div>
      )}
    </SectionShell>
  );
}
