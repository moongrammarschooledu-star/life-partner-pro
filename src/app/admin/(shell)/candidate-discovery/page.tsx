"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, SearchCheck, Filter, LayoutGrid, TableIcon, CheckSquare, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/admin/stat-card";
import { Field, Input, Select } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { formatEnumLabel } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

interface Candidate {
  id: string;
  profileCode: string;
  fullName: string;
  gender: string;
  age: number;
  city: string;
  country: string;
  education: string | null;
  profession: string | null;
  status: string;
  verified: boolean;
  profileCompletion: number;
  photoUrl: string | null;
}

const QUICK_FILTERS = [
  { value: "", label: "All" },
  { value: "NEW_PROFILES", label: "New Profiles" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "ACTIVE", label: "Active" },
  { value: "MATCHING", label: "Matching" },
  { value: "PROPOSAL_SENT", label: "Proposal Sent" },
  { value: "WAITING_FOR_RESPONSE", label: "Waiting for Response" },
  { value: "INTERESTED", label: "Interested" },
  { value: "MEETING_SCHEDULED", label: "Meeting Scheduled" },
  { value: "FINALIZED", label: "Finalized" },
  { value: "MARRIED", label: "Married" },
  { value: "RECENTLY_UPDATED", label: "Recently Updated" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "RECENTLY_VERIFIED", label: "Recently Verified" },
  { value: "FOLLOW_UP_DUE", label: "Follow-up Due" },
  { value: "ASSIGNED_TO_ME", label: "Assigned to Me" },
];

export default function CandidateDiscoveryPage() {
  const { show } = useToast();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [view, setView] = useState<"card" | "table">("card");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [city, setCity] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nlQuery, setNlQuery] = useState("");
  const [nlBusy, setNlBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setPermissions(s?.user?.permissions ?? []))
      .catch(() => setPermissions([]));
  }, []);

  function buildParams(cursor?: string | null) {
    const params = new URLSearchParams();
    if (city) params.set("city", city);
    if (ageMin) params.set("ageMin", ageMin);
    if (ageMax) params.set("ageMax", ageMax);
    if (educationLevel) params.set("educationLevel", educationLevel);
    if (verifiedOnly) params.set("verifiedOnly", "true");
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  function load(append = false) {
    if (!append) setItems(null);
    const params = buildParams(append ? nextCursor : null);
    fetch(`/api/admin/search/profiles?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { items: [], total: 0, nextCursor: null }))
      .then((data) => {
        setItems((prev) => (append ? [...(prev ?? []), ...data.items] : data.items));
        setTotal(data.total ?? 0);
        setNextCursor(data.nextCursor ?? null);
      })
      .catch(() => setItems([]));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, ageMin, ageMax, educationLevel, verifiedOnly]);

  async function runQuickFilterOrSearch() {
    setItems(null);
    const res = await fetch("/api/admin/search/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quickFilter: quickFilter || undefined, search: search || undefined }),
    });
    const data = await res.json().catch(() => ({ items: [], total: 0, nextCursor: null }));
    if (!res.ok) {
      show(data.error ?? "Search failed.", "error");
      setItems([]);
      return;
    }
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setNextCursor(data.nextCursor ?? null);
  }

  async function runNaturalLanguageSearch() {
    if (!nlQuery.trim()) return;
    setNlBusy(true);
    try {
      const parsed = await fetch("/api/admin/search/parse-nl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: nlQuery }) }).then((r) => r.json());
      if (!parsed.filter) {
        show(parsed.unsupported?.[0] ?? "Could not understand this search.", "error");
        return;
      }
      if (parsed.unsupported?.length) show(parsed.unsupported[0], "info");
      // The confirmed structured filter maps 1:1 onto searchByCriteria's
      // flat params (spec §41's confirm-before-execute step) — apply it via
      // the GET quick-criteria path.
      const params = new URLSearchParams();
      if (parsed.filter.city) params.set("city", parsed.filter.city);
      if (parsed.filter.country) params.set("country", parsed.filter.country);
      if (parsed.filter.gender) params.set("gender", parsed.filter.gender);
      if (parsed.filter.ageMin != null) params.set("ageMin", String(parsed.filter.ageMin));
      if (parsed.filter.ageMax != null) params.set("ageMax", String(parsed.filter.ageMax));
      if (parsed.filter.maritalStatus) params.set("maritalStatus", parsed.filter.maritalStatus);
      if (parsed.filter.educationLevel) params.set("educationLevel", parsed.filter.educationLevel);
      if (parsed.filter.profession) params.set("profession", parsed.filter.profession);
      if (parsed.filter.verifiedOnly) params.set("verifiedOnly", "true");
      const results = await fetch(`/api/admin/search/profiles?${params.toString()}`).then((r) => r.json());
      setItems(results.items ?? []);
      setTotal(results.total ?? 0);
      setNextCursor(results.nextCursor ?? null);
      show(`Applied: ${Object.entries(parsed.filter).filter(([k]) => k !== "limit").map(([k, v]) => `${k}=${v}`).join(", ") || "no specific filters recognized"}`, "success");
    } finally {
      setNlBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canCompare = permissions.includes("candidate:compare");
  const canShortlist = permissions.includes("candidate:shortlist");
  const canAdvanced = permissions.includes("search:advanced");

  const compareHref = useMemo(() => `/admin/candidate-discovery/compare?ids=${[...selected].join(",")}`, [selected]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Candidate Discovery</h1>
          <p className="text-sm text-muted">Search, filter, and shortlist candidates — every result respects RBAC, assignment, and privacy controls.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm font-medium">
          {permissions.includes("search:saved:view") && <Link href="/admin/candidate-discovery/saved-searches" className="text-primary hover:underline">Saved Searches</Link>}
          {canShortlist && <Link href="/admin/candidate-discovery/shortlists" className="text-primary hover:underline">Shortlists</Link>}
          <Link href="/admin/candidate-discovery/history" className="text-primary hover:underline">History</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={SearchCheck} label="Results" value={total} />
        <StatCard icon={CheckSquare} label="Selected" value={selected.size} accent={selected.size > 0 ? "info" : "muted"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search by name, Profile ID, or city…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runQuickFilterOrSearch()} className="max-w-md" />
        <Button size="sm" onClick={runQuickFilterOrSearch}>Search</Button>
        <Button size="sm" variant="outline" onClick={() => setShowFilters((s) => !s)}>
          <Filter className="h-4 w-4" /> Filters
        </Button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant={view === "card" ? "primary" : "outline"} onClick={() => setView("card")}><LayoutGrid className="h-4 w-4" /></Button>
          <Button size="sm" variant={view === "table" ? "primary" : "outline"} onClick={() => setView("table")}><TableIcon className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setQuickFilter(f.value); setTimeout(runQuickFilterOrSearch, 0); }}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${quickFilter === f.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted hover:text-foreground"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {canAdvanced && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <Input placeholder="AI-assisted search: e.g. verified candidates in Lahore aged 25-32 with a bachelor's degree" value={nlQuery} onChange={(e) => setNlQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runNaturalLanguageSearch()} className="flex-1" />
          <Button size="sm" onClick={runNaturalLanguageSearch} disabled={nlBusy}>{nlBusy ? "Parsing…" : "Ask"}</Button>
        </div>
      )}

      {showFilters && (
        <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-4">
          <Field label="City" htmlFor="f-city"><Input id="f-city" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
          <Field label="Min Age" htmlFor="f-age-min"><Input id="f-age-min" type="number" value={ageMin} onChange={(e) => setAgeMin(e.target.value)} /></Field>
          <Field label="Max Age" htmlFor="f-age-max"><Input id="f-age-max" type="number" value={ageMax} onChange={(e) => setAgeMax(e.target.value)} /></Field>
          <Field label="Education" htmlFor="f-edu">
            <Select id="f-edu" value={educationLevel} onChange={(e) => setEducationLevel(e.target.value)}>
              <option value="">Any</option>
              {["Matric", "Intermediate", "Bachelors", "Masters", "MPhil", "PhD"].map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified only
          </label>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <span>{selected.size} selected</span>
          {canCompare && <Link href={compareHref} className="font-medium text-primary hover:underline">Compare</Link>}
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {items === null ? (
        <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : items.length === 0 ? (
        <EmptyState icon={SearchCheck} title="No candidates found with the current criteria." description="Try reviewing filters, relaxing preferred criteria, expanding location, or adjusting the age range." />
      ) : view === "card" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} className="mt-1" />
                {c.verified && <Badge variant="success">Verified</Badge>}
              </div>
              <div className="mt-2 h-24 w-full overflow-hidden rounded-lg bg-surface-muted">
                {c.photoUrl ? <img src={c.photoUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-muted">No photo</div>}
              </div>
              <p className="mt-2 font-mono text-xs text-muted">{c.profileCode}</p>
              <p className="font-medium">{c.fullName} · {c.age}</p>
              <p className="text-xs text-muted">{c.city}</p>
              <p className="text-xs text-muted">{c.education ?? "—"} · {c.profession ?? "—"}</p>
              <div className="mt-1 flex items-center justify-between text-xs">
                <Badge variant="muted">{formatEnumLabel(c.status)}</Badge>
                <span className="text-muted">{c.profileCompletion}% complete</span>
              </div>
              <Link href={`/admin/profiles/${c.id}`} className="mt-2 block text-center text-xs font-medium text-primary hover:underline">View Profile</Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3" />
                <th className="p-3">Profile ID</th>
                <th className="p-3">Name</th>
                <th className="p-3">Gender</th>
                <th className="p-3">Age</th>
                <th className="p-3">City</th>
                <th className="p-3">Education</th>
                <th className="p-3">Profession</th>
                <th className="p-3">Verification</th>
                <th className="p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} /></td>
                  <td className="p-3 font-mono text-xs">{c.profileCode}</td>
                  <td className="p-3">{c.fullName}</td>
                  <td className="p-3 text-muted">{formatEnumLabel(c.gender)}</td>
                  <td className="p-3">{c.age}</td>
                  <td className="p-3 text-muted">{c.city}</td>
                  <td className="p-3 text-muted">{c.education ?? "—"}</td>
                  <td className="p-3 text-muted">{c.profession ?? "—"}</td>
                  <td className="p-3">{c.verified ? <Badge variant="success">Verified</Badge> : <Badge variant="muted">Unverified</Badge>}</td>
                  <td className="p-3"><Badge variant="muted">{formatEnumLabel(c.status)}</Badge></td>
                  <td className="p-3"><Link href={`/admin/profiles/${c.id}`} className="font-medium text-primary hover:underline">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => load(true)}>Load more</Button>
        </div>
      )}
    </div>
  );
}
