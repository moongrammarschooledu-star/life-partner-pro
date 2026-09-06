"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Handshake, Filter } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { formatDate, formatEnumLabel } from "@/lib/utils";
import { STATUS_GROUPS } from "@/lib/proposal-status-labels";

interface ProposalItem {
  id: string;
  proposalCode: string;
  status: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  matchScore: number | null;
  createdAt: string;
  profileA: { id: string; profileCode: string; fullName: string; gender: string; city: string };
  profileB: { id: string; profileCode: string; fullName: string; gender: string; city: string };
  createdBy: { name: string } | null;
  assignedTo: { id: string; name: string } | null;
  events: { id: string; status: string; note: string | null; createdAt: string }[];
  responses: { profileId: string; response: string }[];
  meetings: { status: string }[];
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "muted"> = { HIGH: "danger", MEDIUM: "warning", LOW: "muted" };

interface Filters {
  city: string;
  minScore: string;
  createdFrom: string;
  createdTo: string;
  responseStatus: string;
  meetingStatus: string;
}

const emptyFilters: Filters = { city: "", minScore: "", createdFrom: "", createdTo: "", responseStatus: "", meetingStatus: "" };

export default function ProposalsPage() {
  const searchParams = useSearchParams();
  // Seeds from drill-down links (e.g. Reports & Analytics' funnel/KPI cards
  // linking to ?statusGroup=mutual_interest, ?city=Lahore) — only read once
  // on first mount, matching the same pattern /admin/profiles uses.
  const [proposals, setProposals] = useState<ProposalItem[] | null>(null);
  const [group, setGroup] = useState(() => searchParams.get("statusGroup") ?? "all");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => ({ ...emptyFilters, city: searchParams.get("city") ?? "" }));
  const [search, setSearch] = useState("");

  function load() {
    setProposals(null);
    const params = new URLSearchParams();
    if (group !== "all") params.set("statusGroup", group);
    if (filters.city) params.set("city", filters.city);
    if (filters.minScore) params.set("minScore", filters.minScore);
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) params.set("createdTo", filters.createdTo);
    if (filters.responseStatus) params.set("responseStatus", filters.responseStatus);
    if (filters.meetingStatus) params.set("meetingStatus", filters.meetingStatus);
    fetch(`/api/admin/proposals?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setProposals(data.items ?? []));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, filters]);

  const filtered = useMemo(() => {
    if (!proposals) return [];
    if (!search.trim()) return proposals;
    const q = search.trim().toLowerCase();
    return proposals.filter(
      (p) =>
        p.proposalCode.toLowerCase().includes(q) ||
        p.profileA.fullName.toLowerCase().includes(q) ||
        p.profileA.profileCode.toLowerCase().includes(q) ||
        p.profileB.fullName.toLowerCase().includes(q) ||
        p.profileB.profileCode.toLowerCase().includes(q)
    );
  }, [proposals, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Rishta Proposal Management</h1>
          <p className="text-sm text-muted">Track proposals between profiles from draft through to finalization.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
          <Filter className="h-4 w-4" /> Filters
        </Button>
      </div>

      <Input placeholder="Search by Proposal ID, Profile ID, or name…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="City" htmlFor="f-city">
            <Input id="f-city" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} />
          </Field>
          <Field label="Min Score %" htmlFor="f-score">
            <Input id="f-score" type="number" value={filters.minScore} onChange={(e) => setFilters({ ...filters, minScore: e.target.value })} />
          </Field>
          <Field label="Created From" htmlFor="f-from">
            <Input id="f-from" type="date" value={filters.createdFrom} onChange={(e) => setFilters({ ...filters, createdFrom: e.target.value })} />
          </Field>
          <Field label="Created To" htmlFor="f-to">
            <Input id="f-to" type="date" value={filters.createdTo} onChange={(e) => setFilters({ ...filters, createdTo: e.target.value })} />
          </Field>
          <Field label="Response Status" htmlFor="f-response">
            <Select id="f-response" value={filters.responseStatus} onChange={(e) => setFilters({ ...filters, responseStatus: e.target.value })}>
              <option value="">Any</option>
              <option value="PENDING">No response yet</option>
              <option value="DECLINED">Declined by either side</option>
            </Select>
          </Field>
          <Field label="Meeting Status" htmlFor="f-meeting">
            <Select id="f-meeting" value={filters.meetingStatus} onChange={(e) => setFilters({ ...filters, meetingStatus: e.target.value })}>
              <option value="">Any</option>
              {["REQUESTED", "SCHEDULED", "CONFIRMED", "COMPLETED", "RESCHEDULED", "CANCELLED"].map((s) => (
                <option key={s} value={s}>
                  {formatEnumLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Tabs
        value={group}
        onChange={setGroup}
        tabs={[{ value: "all", label: "All" }, ...STATUS_GROUPS.map((g) => ({ value: g.key, label: g.label }))]}
      />

      {proposals === null ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Handshake} title="No proposals in this view" description="Create a proposal from a profile's Matches tab or the Matching Center." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Proposal</th>
                <th className="p-3">Profile A</th>
                <th className="p-3">Profile B</th>
                <th className="p-3">Match %</th>
                <th className="p-3">Status</th>
                <th className="p-3">Priority</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Created</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono text-xs">{p.proposalCode}</td>
                  <td className="p-3">
                    {p.profileA.fullName} <span className="text-muted">({p.profileA.profileCode})</span>
                  </td>
                  <td className="p-3">
                    {p.profileB.fullName} <span className="text-muted">({p.profileB.profileCode})</span>
                  </td>
                  <td className="p-3">{p.matchScore != null ? `${p.matchScore}%` : "—"}</td>
                  <td className="p-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="p-3">
                    <Badge variant={PRIORITY_VARIANT[p.priority]}>{formatEnumLabel(p.priority)}</Badge>
                  </td>
                  <td className="p-3 text-muted">{p.assignedTo?.name ?? "—"}</td>
                  <td className="p-3 text-muted">{formatDate(p.createdAt)}</td>
                  <td className="p-3">
                    <Link href={`/admin/proposals/${p.id}`} className="font-medium text-primary hover:underline">
                      View
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
