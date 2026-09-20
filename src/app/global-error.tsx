"use client";

import { useEffect } from "react";

// Last-resort boundary (replaces the root layout), so it must render its own
// <html>/<body> and cannot rely on app CSS. Neutral message only (spec §57).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digest: error.digest, name: error.name, path: window.location.pathname, fatal: true }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", textAlign: "center", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Life Partner Pro</h1>
          <p style={{ color: "#666" }}>Something went wrong. Please try again later.</p>
        </div>
      </body>
    </html>
  );
}
