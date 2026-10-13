"use client";

import { useEffect } from "react";

// Registers the public-assets-only service worker (public/sw.js). Production only, so local development is never served stale files.
// A failure to register is harmless: the site works exactly the same without it.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}
