"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { SECTIONS } from "@/lib/platform/sections";
import { SensitiveActionDialog, callApi } from "@/components/admin/system/shared";
import { cn } from "@/lib/utils";

// STEP 36 — shared pieces of the Control Center screens. The server decides what a caller may see and change; the screen only hides what would be refused.

export type Can = (permission: string) => boolean;
export const makeCan = (permissions: string[]): Can => (p) => permissions.includes(p);

export function fmt(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const ENV_TONE: Record<string, "danger" | "warning" | "info"> = { PRODUCTION: "danger", STAGING: "warning", DEVELOPMENT: "info" };
export function EnvironmentBadge({ environment }: { environment?: string | null }) {
  if (!environment) return null;
  return <Badge variant={ENV_TONE[environment] ?? "muted"}>{environment.charAt(0) + environment.slice(1).toLowerCase()} environment</Badge>;
}

export function CcHeader({ title, description, permissions, environment }: { title: string; description: string; permissions: string[]; environment?: string | null }) {
  const path = usePathname();
  const can = makeCan(permissions);
  const visible = SECTIONS.filter((s) => (s.page || s.key === "overview") && (!s.requires || can(s.requires)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>
        </div>
        <EnvironmentBadge environment={environment} />
      </div>
      <nav aria-label="Control Center" className="flex gap-1 overflow-x-auto border-b border-border">
        {visible.map((s) => {
          const href = s.page ?? "/admin/control-center";
          const active = href === "/admin/control-center" ? path === href : path.startsWith(href);
          return (
            <Link key={s.key} href={href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-primary font-medium text-primary" : "border-transparent text-muted hover:text-foreground")}>
              {s.label}
            </Link>
          );
        })}
      </nav>
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

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "danger" | "warning" | "success" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Source({ children, at }: { children: ReactNode; at?: string | Date | null }) {
  return <p className="mt-2 text-xs text-muted">Source: {children}{at ? ` · as of ${fmt(at)}` : ""}</p>;
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "muted"> = {
  CONNECTED: "success", HEALTHY: "success", OK: "success", OPERATIONAL: "success", ENABLED: "success", PUBLISHED: "success", ACTIVE: "success",
  DEGRADED: "warning", PAUSED: "warning", ROLLOUT: "info", SANDBOX: "info", NOT_CONFIGURED: "muted", DISABLED: "muted", DRAFT: "muted", NOT_ENFORCED: "muted", UNKNOWN: "muted",
  FAILED: "danger", UNAVAILABLE: "danger", RESOLVED: "muted", ENDED: "muted", EMERGENCY_DISABLED: "danger", ERROR: "danger", DISRUPTION: "danger",
};
export function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="muted">—</Badge>;
  return <Badge variant={STATUS_TONE[status] ?? "muted"}>{status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export interface ChangeResult {
  error?: string;
  /** The change was sent for approval instead of being applied. */
  approvalCode?: string;
}

/**
 * A change dialog used by every Control Center write. It asks for: the environment (typed, so a change cannot be made to the wrong one), a reason, and the
 * administrator's password. `submit` receives all three and returns an error text, or null on success.
 */
export function ChangeDialog({ open, title, description, confirmLabel, danger, environment, children, onCancel, submit }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  environment: string;
  children?: ReactNode;
  onCancel: () => void;
  submit: (params: { reason: string; stepUpToken: string; environment: string }) => Promise<string | null>;
}) {
  return (
    <SensitiveActionDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      danger={danger}
      extraField={{ label: `Type the environment you are changing (${environment.toLowerCase()})`, hint: "The server refuses the change if this is not the environment it is running in.", placeholder: environment.toLowerCase() }}
      onCancel={onCancel}
      onConfirm={({ reason, stepUpToken, extra }) => submit({ reason, stepUpToken, environment: extra })}
    >
      {children}
    </SensitiveActionDialog>
  );
}

/** Sends a change and turns the response into a message: null = applied, otherwise the text to show. A 202 means "waiting for approval". */
export async function sendChange(url: string, method: "POST" | "PATCH", body: Record<string, unknown>): Promise<{ error: string | null; approvalCode?: string }> {
  const res = await callApi<{ approvalRequired?: boolean; approvalCode?: string }>(url, method, body);
  if (res.status === 202 && res.data.approvalCode) return { error: null, approvalCode: res.data.approvalCode };
  if (!res.ok) return { error: res.data.error ?? "The change was not saved." };
  return { error: null };
}

export function ApprovalNote({ code, onClose }: { code: string; onClose: () => void }) {
  return (
    <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-muted p-3 text-sm">
      <p>This change needs a second administrator&apos;s approval before it takes effect. Approval request <span className="font-mono">{code}</span> was created; nothing has changed yet.</p>
      <button type="button" className="text-primary hover:underline" onClick={onClose}>Dismiss</button>
    </div>
  );
}

export function useApprovalNote() {
  const [code, setCode] = useState<string | null>(null);
  return { code, set: setCode, clear: () => setCode(null) };
}
