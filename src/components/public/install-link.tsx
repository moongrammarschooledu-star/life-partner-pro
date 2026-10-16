"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { detectInstallEnvironment, installInstruction, installMode, INSTALL_MANUAL_DELAY_MS, type InstallMode } from "@/lib/public-site/install-policy";

// "Install the app" in the footer: always there, so the offer is not lost when the box at the bottom was dismissed, never came up (some browsers send no install event), or
// the visitor simply scrolled past it. One tap installs when the browser allows it; otherwise it shows, right there, what to do in that browser. Hidden once the app is installed.
export function InstallLink() {
  const [visible, setVisible] = useState(false);
  const [instruction, setInstruction] = useState<string | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setVisible(!standalone);
  }, []);

  async function onClick() {
    const event = (window as unknown as { __lppInstall?: { prompt: () => Promise<void>; userChoice: Promise<unknown> } }).__lppInstall;
    if (event) {
      await event.prompt();
      await event.userChoice.catch(() => null);
      (window as unknown as { __lppInstall?: unknown }).__lppInstall = undefined;
      return;
    }
    // The visitor has had all the time the page was open for the install event to arrive, so the wait before the "menu" instruction is already over.
    const mode: InstallMode = installMode({ canPrompt: false, env: detectInstallEnvironment(navigator.userAgent), waitedMs: INSTALL_MANUAL_DELAY_MS });
    setInstruction(installInstruction(mode));
  }

  if (!visible) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium text-foreground">App</span>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 py-1 text-left text-muted hover:text-foreground">
        <Download className="h-4 w-4" aria-hidden="true" /> Install the app
      </button>
      {instruction && (
        <p role="status" className="max-w-[16rem] text-xs text-muted">
          {instruction}
        </p>
      )}
    </div>
  );
}
