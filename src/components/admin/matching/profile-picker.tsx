"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, X } from "lucide-react";

export interface PickedProfile {
  id: string;
  profileCode: string;
  fullName: string;
  age: number;
  gender: string;
  city: string;
}

export function ProfilePicker({ selected, onSelect }: { selected: PickedProfile | null; onSelect: (p: PickedProfile | null) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedProfile[] | null>(null);
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

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-muted px-4 py-2.5">
        <div className="text-sm">
          <span className="font-medium">{selected.fullName}</span>{" "}
          <span className="text-muted">
            · {selected.profileCode} · {selected.age} yrs · {selected.city}
          </span>
        </div>
        <button onClick={() => onSelect(null)} className="text-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

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
          placeholder="Search Profile ID or Name…"
          className="h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}
      </div>
      {open && results !== null && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted">No profiles found.</p>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  onSelect(r);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-left text-sm last:border-0 hover:bg-surface-muted"
              >
                <span className="truncate font-medium">{r.fullName}</span>
                <span className="shrink-0 text-xs text-muted">
                  {r.profileCode} · {r.age} yrs · {r.city}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
