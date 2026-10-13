"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";

// Offline notice for the website, the installed web app and the mobile apps (STEP 37 §5). Private account screens are never kept for offline use, so while
// the phone is offline they cannot load: this says so plainly and reconnects by itself when the network is back.
export function OfflineBanner() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const [back, setBack] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    const update = () => {
      const off = !navigator.onLine;
      setOffline(off);
      if (off) wasOffline.current = true;
      else if (wasOffline.current) {
        wasOffline.current = false;
        setBack(true);
        router.refresh();
        window.setTimeout(() => setBack(false), 2500);
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [router]);

  if (!offline && !back) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-0 z-[90] flex items-center justify-center gap-2 border-t border-border bg-surface px-4 py-2 text-sm shadow-lg">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{offline ? "You’re offline. Some private account features are temporarily unavailable." : "You’re back online."}</span>
    </div>
  );
}