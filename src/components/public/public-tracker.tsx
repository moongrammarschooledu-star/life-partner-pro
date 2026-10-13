"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Anonymous funnel counting for the public site (page views, call-to-action clicks, registration started). The server decides whether anything
// is recorded at all (the feature is off by default) and never stores more than a public page path. Visitors who have asked not to be tracked
// (Do Not Track or Global Privacy Control) are not counted: nothing is even sent.
function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return nav.doNotTrack === "1" || nav.msDoNotTrack === "1" || nav.globalPrivacyControl === true;
}

function send(body: { type: "PAGE_VIEW" | "CTA_CLICK" | "REGISTRATION_STARTED"; path: string; cta?: string }) {
  if (optedOut()) return;
  try {
    void fetch("/api/public-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  } catch {
    /* counting must never affect the page */
  }
}

export function PublicTracker() {
  const pathname = usePathname();

  useEffect(() => {
    send({ type: "PAGE_VIEW", path: pathname });
    if (pathname === "/register") send({ type: "REGISTRATION_STARTED", path: pathname });
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const el = (e.target as Element | null)?.closest?.("[data-cta]");
      const cta = el?.getAttribute("data-cta");
      if (cta) send({ type: "CTA_CLICK", path: window.location.pathname, cta });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return null;
}
