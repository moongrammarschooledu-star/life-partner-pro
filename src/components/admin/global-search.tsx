"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";

interface SearchResult {
  id: string;
  profileCode: string;
  fullName: string;
  gender: string;
  age: number;
  city: string;
  status: string;
  profession: string | null;
}

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/admin/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data) => setResults(data.results ?? []))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search name, Profile ID, phone, city, profession…"
          className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      {open && results !== null && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted">No profiles found.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  router.push(`/admin/profiles/${r.id}`);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-left text-sm last:border-0 hover:bg-surface-muted"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.fullName}</p>
                  <p className="truncate text-xs text-muted">
                    {r.profileCode} · {r.age} yrs · {r.city}
                    {r.profession ? ` · ${r.profession}` : ""}
                  </p>
                </div>
                <StatusBadge status={r.status} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
