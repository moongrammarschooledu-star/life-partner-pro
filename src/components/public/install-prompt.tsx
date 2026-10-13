"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INSTALL_DISMISS_DAYS, INSTALL_MIN_PAGEVIEWS, installPromptVisible } from "@/lib/public-site/install-policy";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "lpp_install_dismissed_until";
const VIEWS_KEY = "lpp_pageviews";

// Storage can be unavailable (private mode, blocked cookies): every access is guarded and the prompt simply stays hidden.
function readNumber(storage: "local" | "session", key: string): number {
  try {
    const raw = (storage === "local" ? localStorage : sessionStorage).getItem(key);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}
function writeNumber(storage: "local" | "session", key: string, value: number) {
  try {
    (storage === "local" ? localStorage : sessionStorage).setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

// "Install Life Partner Pro": offered only after the visitor has looked around (not on the first page), never while already installed,
// and a dismissal is remembered for 60 days. Browsers that cannot show an install dialog (iPhone Safari) get a one-line instruction.
export function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [standalone, setStandalone] = useState(true); // hidden until we know
  const [views, setViews] = useState(0);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [now, setNow] = useState(0); // read once the page is in the browser; never during render

  useEffect(() => {
    setNow(Date.now());
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent));
    setDismissedUntil(readNumber("local", DISMISS_KEY));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const next = readNumber("session", VIEWS_KEY) + 1;
    writeNumber("session", VIEWS_KEY, next);
    setViews(next);
  }, [pathname]);

  function dismiss() {
    const until = Date.now() + INSTALL_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    writeNumber("local", DISMISS_KEY, until);
    setDismissedUntil(until);
    setNow(Date.now());
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setDeferred(null);
    dismiss();
  }

  if (!installPromptVisible({ canPrompt: deferred !== null, ios, standalone, views, dismissedUntil, now })) return null;

  return (
    <aside role="region" aria-label="Install Life Partner Pro" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg">
      <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Install Life Partner Pro</p>
        {deferred ? (
          <p className="mt-1 text-muted">Add it to your home screen for quick access. Nothing private is stored for offline use.</p>
        ) : (
          <p className="mt-1 text-muted">On iPhone: tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</p>
        )}
        <div className="mt-3 flex gap-2">
          {deferred && <Button size="sm" onClick={install}>Install</Button>}
          <Button size="sm" variant="outline" onClick={dismiss}>Not now</Button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss install suggestion" className="rounded p-1 text-muted hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
