"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Users } from "lucide-react";
import { FilterPanel, emptyFilters, type ProfileFilters } from "@/components/admin/filter-panel";
import { ProfileTable } from "@/components/admin/profile-table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProfileListDto } from "@/lib/serializers";

export default function ProfilesPage() {
  const searchParams = useSearchParams();
  // Seeds from the nav's "New Profiles" / "Verified Profiles" preset links
  // (?status=NEW, ?verified=true) — only read once on first mount so the
  // filter panel remains the source of truth afterwards.
  const [filters, setFilters] = useState<ProfileFilters>(() => ({
    ...emptyFilters,
    status: searchParams.get("status") ?? "",
    verified: searchParams.get("verified") ?? "",
  }));
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ProfileListDto[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));

    fetch(`/api/admin/profiles?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items ?? []);
        setTotalPages(data.totalPages ?? 1);
        setTotal(data.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Profiles</h1>
          <p className="text-sm text-muted">{total} profile{total === 1 ? "" : "s"} found</p>
        </div>
      </div>

      <FilterPanel
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
        onReset={() => {
          setFilters(emptyFilters);
          setPage(1);
        }}
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Users} title="No profiles found" description="Try adjusting your filters or search terms." />
      ) : (
        <>
          <ProfileTable profiles={items} />
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
