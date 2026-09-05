"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Filter, ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

interface QueueItem {
  id: string;
  status: string;
  updatedAt: string;
  assignedTo: { id: string; name: string } | null;
  profile: { id: string; profileCode: string; fullName: string; city: string; createdAt: string; profileCompletion: number; status: string };
}

interface DashboardData {
  kpis: {
    totalProfiles: number;
    pendingVerification: number;
    verified: number;
    inProgress: number;
    rejected: number;
    expired: number;
    reVerificationRequired: number;
  };
  items: QueueItem[];
}

const STATUS_OPTIONS = [
  "NOT_VERIFIED",
  "VERIFICATION_PENDING",
  "UNDER_REVIEW",
  "VERIFICATION_REQUIRED",
  "VERIFIED",
  "VERIFICATION_REJECTED",
  "VERIFICATION_EXPIRED",
  "RE_VERIFICATION_REQUIRED",
];

interface Filters {
  status: string;
  profileId: string;
  name: string;
  city: string;
  registeredFrom: string;
  registeredTo: string;
  minCompleteness: string;
}
const emptyFilters: Filters = { status: "", profileId: "", name: "", city: "", registeredFrom: "", registeredTo: "", minCompleteness: "" };

export default function VerificationCenterPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    fetch(`/api/admin/verification/dashboard?${params.toString()}`)
      .then((r) => r.json())
      .then(setData);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  async function runDuplicateScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/admin/verification/duplicate-scan", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error();
      setScanResult(`Scanned ${json.profilesScanned} profiles — ${json.flagsCreated} new potential duplicate flag(s) created.`);
    } catch {
      setScanResult("Could not run duplicate scan.");
    } finally {
      setScanning(false);
    }
  }

  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const kpiCards = [
    { label: "Total Profiles", value: data.kpis.totalProfiles },
    { label: "Pending Verification", value: data.kpis.pendingVerification },
    { label: "Verified", value: data.kpis.verified },
    { label: "Verification In Progress", value: data.kpis.inProgress },
    { label: "Rejected", value: data.kpis.rejected },
    { label: "Expired", value: data.kpis.expired },
    { label: "Requiring Re-Verification", value: data.kpis.reVerificationRequired },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Verification Center</h1>
          <p className="text-sm text-muted">Review profiles for genuineness, completeness, and trust before they enter active matching.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
            <Filter className="h-4 w-4" /> Filters
          </Button>
          <Button size="sm" variant="outline" onClick={runDuplicateScan} disabled={scanning}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Scan for Duplicates
          </Button>
        </div>
      </div>

      {scanResult && <p className="rounded-lg bg-surface-muted p-3 text-sm">{scanResult}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {kpiCards.map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-surface p-3 text-center">
            <p className="text-xl font-semibold">{k.value}</p>
            <p className="mt-1 text-xs text-muted">{k.label}</p>
          </div>
        ))}
      </div>

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Status" htmlFor="f-status">
            <Select id="f-status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Profile ID" htmlFor="f-pid">
            <Input id="f-pid" value={filters.profileId} onChange={(e) => setFilters({ ...filters, profileId: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="f-name">
            <Input id="f-name" value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} />
          </Field>
          <Field label="City" htmlFor="f-city">
            <Input id="f-city" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} />
          </Field>
          <Field label="Registered From" htmlFor="f-rf">
            <Input id="f-rf" type="date" value={filters.registeredFrom} onChange={(e) => setFilters({ ...filters, registeredFrom: e.target.value })} />
          </Field>
          <Field label="Registered To" htmlFor="f-rt">
            <Input id="f-rt" type="date" value={filters.registeredTo} onChange={(e) => setFilters({ ...filters, registeredTo: e.target.value })} />
          </Field>
          <Field label="Min Completeness %" htmlFor="f-mc">
            <Input id="f-mc" type="number" value={filters.minCompleteness} onChange={(e) => setFilters({ ...filters, minCompleteness: e.target.value })} />
          </Field>
        </div>
      )}

      {data.items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No profiles match these filters" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Profile</th>
                <th className="p-3">City</th>
                <th className="p-3">Completeness</th>
                <th className="p-3">Verification Status</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Registered</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="p-3">
                    {item.profile.fullName} <span className="text-muted">({item.profile.profileCode})</span>
                  </td>
                  <td className="p-3">{item.profile.city}</td>
                  <td className="p-3">{item.profile.profileCompletion}%</td>
                  <td className="p-3">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="p-3 text-muted">{item.assignedTo?.name ?? "—"}</td>
                  <td className="p-3 text-muted">{formatDate(item.profile.createdAt)}</td>
                  <td className="p-3">
                    <Link href={`/admin/verification/${item.profile.id}`} className="font-medium text-primary hover:underline">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
