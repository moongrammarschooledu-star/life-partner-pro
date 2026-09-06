"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ViewAsStatus {
  active: boolean;
  targetName?: string;
  expiresAt?: string;
}

// Spec §18 — shown whenever a View-As grant is active for the current
// browser session. Only a small, deliberate set of read routes actually
// resolve the impersonated identity (see route-guard.ts's allowViewAs
// option) — every other page/action still 403s while this banner is up.
export function ViewAsBanner() {
  const router = useRouter();
  const [status, setStatus] = useState<ViewAsStatus | null>(null);

  useEffect(() => {
    fetch("/api/admin/view-as/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ active: false }));
  }, []);

  if (!status?.active) return null;

  async function endViewAs() {
    await fetch("/api/admin/view-as/end", { method: "POST" });
    router.push("/admin/dashboard");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-warning px-4 py-2 text-sm text-warning-foreground">
      <span className="flex items-center gap-2">
        <Eye className="h-4 w-4" /> Viewing as {status.targetName} — read-only, ends automatically at{" "}
        {status.expiresAt ? new Date(status.expiresAt).toLocaleTimeString() : "soon"}.
      </span>
      <Button size="sm" variant="outline" onClick={endViewAs}>
        End View-As
      </Button>
    </div>
  );
}
