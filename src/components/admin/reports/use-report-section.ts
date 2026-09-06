"use client";

import { useEffect, useState } from "react";

// Shared fetch-on-activation hook for every Reports tab — only fetches once
// the section is enabled (its tab has been opened at least once), and
// re-fetches whenever the query string (filters) changes while active.
export function useReportSection<T>(endpoint: string, queryString: string, enabled: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`${endpoint}?${queryString}`)
      .then((r) => {
        if (!r.ok) throw new Error("Request failed");
        return r.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, queryString, enabled]);

  return { data, loading, error };
}
