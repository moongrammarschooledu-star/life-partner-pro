"use client";

import { useEffect } from "react";

// Neutral user-facing error page (spec §57) — never shows stack traces, SQL,
// service names or internal detail. Reports only the opaque Next error digest
// (plus the path) to /api/client-errors for centralised monitoring (§13).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digest: error.digest, name: error.name, path: window.location.pathname }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="font-heading text-2xl font-semibold">Something went wrong</h1>
        <p className="text-muted">Something went wrong. Please try again later.</p>
        <button onClick={reset} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
          Try again
        </button>
      </div>
    </main>
  );
}
