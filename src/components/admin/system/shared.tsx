"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

// Small shared helpers for the STEP 15 System / Operations admin pages.

export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError((json as { error?: string }).error ?? `Request failed (${res.status})`);
          setData(null);
        } else {
          setError(null);
          setData(json as T);
        }
      })
      .catch(() => !cancelled && setError("Could not load data."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export async function callApi<T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { ok: res.ok, status: res.status, data };
}

export function Loading() {
  return (
    <div className="flex h-32 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted" />
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{message}</div>;
}

const VARIANT: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  PASS: "success", OK: "success", ok: "success", HEALTHY: "success", COMPLETED: "success", PASSED: "success", READY: "success", CLEAN: "success", SUCCESS: "success", RESOLVED: "success", CLOSED: "muted", NORMAL: "success",
  WARN: "warning", WARNING: "warning", degraded: "warning", DEGRADED: "warning", "PASS WITH WARNINGS": "warning", RETRYING: "warning", PENDING: "warning", FINDINGS: "warning", NEW: "warning", not_configured: "muted", unknown: "muted", NOT_CONFIGURED: "muted",
  BLOCKED: "danger", down: "danger", FAILED: "danger", FAIL: "danger", CRITICAL: "danger", "NOT READY": "danger", DEAD_LETTER: "danger", UNHEALTHY: "danger", HIGH: "danger", EMERGENCY: "danger", RECOVERY: "danger", MAINTENANCE: "warning",
  RUNNING: "info", ACKNOWLEDGED: "info", INVESTIGATING: "info", MITIGATING: "info", DEPLOYING: "info", INFO: "info", MEDIUM: "warning", LOW: "muted", CANCELLED: "muted",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="muted">—</Badge>;
  return <Badge variant={VARIANT[status] ?? "muted"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Card({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="font-medium">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const ms = Date.now() - new Date(value).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

// High-risk action dialog: collects a written reason (optional) and the admin's
// password, exchanges it for a short-lived re-auth token (same primitive used
// for refund execution) and hands both to the caller. The password never
// leaves this component except to /api/admin/auth/reauth.
export function SensitiveActionDialog({
  open, title, description, confirmLabel = "Confirm", danger, requireReason = true, extraField, children, onCancel, onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  extraField?: { label: string; hint?: string; placeholder?: string };
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: (params: { reason: string; stepUpToken: string; extra: string }) => Promise<string | null | void>;
}) {
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setReason(""); setPassword(""); setExtra(""); setError(null); setBusy(false);
    onCancel();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await callApi<{ token?: string }>("/api/admin/auth/reauth", "POST", { password });
      if (!res.ok || !res.data.token) {
        setError(res.data.error ?? "Password confirmation failed.");
        return;
      }
      const failure = await onConfirm({ reason, stepUpToken: res.data.token, extra });
      if (failure) setError(failure);
      else close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={busy ? "Working…" : confirmLabel}
      danger={danger}
      confirmDisabled={busy || !password || (requireReason && reason.trim().length < 5) || (Boolean(extraField) && !extra.trim())}
      onConfirm={submit}
      onCancel={close}
    >
      {children}
      {extraField && (
        <Field label={extraField.label} hint={extraField.hint} htmlFor="sensitive-extra">
          <Input id="sensitive-extra" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={extraField.placeholder} autoComplete="off" />
        </Field>
      )}
      {requireReason && (
        <Field label="Reason (recorded in the audit log)" htmlFor="sensitive-reason">
          <Textarea id="sensitive-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <Field label="Confirm your password" htmlFor="sensitive-password">
        <Input id="sensitive-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
    </ConfirmDialog>
  );
}
