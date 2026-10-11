"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// STEP 32 — shared pieces of the Security Operations screens.

export type Can = (permission: string) => boolean;
export const makeCan = (permissions: string[]): Can => (p) => permissions.includes(p);

const SEVERITY: Record<string, "danger" | "warning" | "info" | "muted"> = { CRITICAL: "danger", HIGH: "danger", MEDIUM: "warning", LOW: "info", INFO: "muted" };
export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge variant={SEVERITY[severity] ?? "muted"}>{severity}</Badge>;
}

const READINESS: Record<string, "success" | "warning" | "danger"> = { PRODUCTION_READY: "success", READY_WITH_WARNINGS: "warning", NOT_READY: "danger" };
export function ReadinessBadge({ state }: { state: string }) {
  return <Badge variant={READINESS[state] ?? "muted"}>{state.replace(/_/g, " ")}</Badge>;
}

const CHECK: Record<string, "success" | "warning" | "danger"> = { PASS: "success", WARN: "warning", FAIL: "danger" };
export function CheckBadge({ status }: { status: string }) {
  return <Badge variant={CHECK[status] ?? "muted"}>{status}</Badge>;
}

export function fmt(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function minutesLabel(m: number | null | undefined): string {
  if (m == null) return "Not measured yet";
  if (m < 90) return `${m} min`;
  if (m < 60 * 48) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
}

// Every screen shows where its figures come from and when they were read.
export function Source({ children, at }: { children: ReactNode; at?: string | Date | null }) {
  return <p className="mt-2 text-xs text-muted">Source: {children}{at ? ` · as of ${fmt(at)}` : ""}</p>;
}

const NAV: Array<{ href: string; label: string; permission: string }> = [
  { href: "/admin/security-operations", label: "Overview", permission: "soc:view" },
  { href: "/admin/security-operations/alerts", label: "Alerts", permission: "soc:alerts:view" },
  { href: "/admin/security-operations/incidents", label: "Incidents", permission: "soc:incidents:view" },
  { href: "/admin/security-operations/rules", label: "Detection rules", permission: "soc:rules:view" },
  { href: "/admin/security-operations/admin-security", label: "Admin security", permission: "soc:admin_security:view" },
  { href: "/admin/security-operations/backups", label: "Backups", permission: "soc:backups:view" },
  { href: "/admin/security-operations/restore-drills", label: "Restore drills", permission: "soc:backups:view" },
  { href: "/admin/security-operations/disaster-recovery", label: "Disaster recovery", permission: "soc:dr:view" },
  { href: "/admin/security-operations/configuration", label: "Configuration", permission: "soc:config:view" },
  { href: "/admin/security-operations/audit", label: "Audit", permission: "soc:audit:view" },
];

export function SocNav({ can }: { can: Can }) {
  const path = usePathname();
  return (
    <nav aria-label="Security Operations" className="flex gap-1 overflow-x-auto border-b border-border">
      {NAV.filter((n) => can(n.permission)).map((n) => {
        const active = n.href === "/admin/security-operations" ? path === n.href : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-foreground")}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SocHeader({ title, description, can }: { title: string; description: string; can: Can }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
      </div>
      <SocNav can={can} />
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "danger" | "warning" | "success" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted">{head.map((h) => <th key={h} scope="col" className="px-2 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
      {empty && <p className="px-2 py-3 text-sm text-muted">{empty}</p>}
    </div>
  );
}
