"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INSTALL_DISMISS_DAYS,
  INSTALL_MANUAL_DELAY_MS,
  detectInstallEnvironment,
  installMode,
  installPromptVisible,
  type InstallEnvironment,
} from "@/lib/public-site/install-policy";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Set by the early script in the root layout, which catches the browser event before this component has loaded. */
    __lppInstall?: BeforeInstallPromptEvent;
  }
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

// "Install Life Partner Pro": offered on the very first page a visitor opens, never while already installed, and a dismissal is remembered for 60 days.
// The browser fires its install event early, often before the page has finished loading, so a tiny script in the root layout catches it and this component
// picks it up. Many visitors arrive from Facebook / Instagram / WhatsApp, whose built-in browsers cannot install a site at all, and some browsers (iPhone,
// Firefox, Samsung Internet) never send the event: for those the box explains how to install instead of showing nothing (see install-policy.ts).
export function InstallPrompt() {
  const pathname = usePathname();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [env, setEnv] = useState<InstallEnvironment>({ ios: false, android: false, inApp: false });
  const [standalone, setStandalone] = useState(true); // hidden until we know
  const [views, setViews] = useState(0);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [now, setNow] = useState(0); // read once the page is in the browser; never during render
  const [waited, setWaited] = useState(false); // the install event had its chance to arrive

  useEffect(() => {
    setNow(Date.now());
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
    setEnv(detectInstallEnvironment(navigator.userAgent));
    setDismissedUntil(readNumber("local", DISMISS_KEY));
    if (window.__lppInstall) setDeferred(window.__lppInstall);
    const onEarly = () => setDeferred(window.__lppInstall ?? null);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__lppInstall = e as BeforeInstallPromptEvent;
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      window.__lppInstall = undefined;
      setDeferred(null);
    };
    const timer = window.setTimeout(() => setWaited(true), INSTALL_MANUAL_DELAY_MS);
    window.addEventListener("lpp-install-ready", onEarly);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("lpp-install-ready", onEarly);
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
    window.__lppInstall = undefined;
    setDeferred(null);
    dismiss();
  }

  const mode = installMode({ canPrompt: deferred !== null, env, waitedMs: waited ? INSTALL_MANUAL_DELAY_MS : 0 });
  if (!installPromptVisible({ canPrompt: mode !== "none", ios: false, standalone, views, dismissedUntil, now })) return null;

  return (
    <aside role="region" aria-label="Install Life Partner Pro" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg">
      <Download className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-medium">Install Life Partner Pro</p>
        {mode === "native" && <p className="mt-1 text-muted">Add it to your home screen for quick access. Nothing private is stored for offline use.</p>}
        {mode === "inapp" && (
          <p className="mt-1 text-muted">
            To install the app, open this page in your phone&apos;s browser: tap the menu (&#8942; or &hellip;) at the top and choose &ldquo;Open in browser&rdquo; or &ldquo;Open in Chrome / Safari&rdquo;.
          </p>
        )}
        {mode === "ios" && <p className="mt-1 text-muted">On iPhone: tap the Share button, then &ldquo;Add to Home Screen&rdquo;.</p>}
        {mode === "manual" && <p className="mt-1 text-muted">Open your browser menu (&#8942;) and tap &ldquo;Install app&rdquo; or &ldquo;Add to Home screen&rdquo;.</p>}
        <div className="mt-3 flex gap-2">
          {mode === "native" && <Button size="sm" onClick={install}>Install</Button>}
          <Button size="sm" variant="outline" onClick={dismiss}>Not now</Button>
        </div>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss install suggestion" className="rounded p-1 text-muted hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
