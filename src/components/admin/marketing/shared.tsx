"use client";

import { callApi } from "@/components/admin/system/shared";

// Helpers shared by the Marketing Center screens.

export interface PolicyFinding { rule: string; severity: "BLOCK" | "WARN"; field?: string; snippet: string }

export type ToastFn = (message: string, variant?: "success" | "error" | "info") => void;

export function money(minor: number | null | undefined, currency = "PKR"): string {
  if (minor === null || minor === undefined) return "—";
  return `${currency} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Runs a mutating call and reports the outcome. A 202 means the STEP 19 maker-checker gate is holding the action: it is
// reported as "approval required", never as success. Returns true only when the action actually happened.
export async function act(show: ToastFn, url: string, method: "POST" | "PATCH" | "DELETE", body: unknown, okMessage: string): Promise<boolean> {
  const res = await callApi<{ approvalRequired?: boolean; approvalCode?: string; findings?: PolicyFinding[]; failures?: string[] }>(url, method, body);
  if (res.status === 202 && res.data.approvalRequired) {
    show(`Approval required (${res.data.approvalCode}). It will proceed once an authorised approver approves it.`, "info");
    return false;
  }
  if (!res.ok) {
    const detail = res.data.findings?.filter((f) => f.severity === "BLOCK").slice(0, 3).map((f) => f.rule.replace(/_/g, " ").toLowerCase()).join(", ") ?? res.data.failures?.[0];
    show(`${res.data.error ?? "That did not work."}${detail ? ` (${detail})` : ""}`, "error");
    return false;
  }
  show(okMessage, "success");
  return true;
}

export function FindingsList({ findings }: { findings: PolicyFinding[] }) {
  if (!findings.length) return <p className="text-sm text-muted">No content-policy findings.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {findings.map((f, i) => (
        <li key={i} className={f.severity === "BLOCK" ? "text-danger" : "text-warning"}>
          <span className="font-medium">{f.severity === "BLOCK" ? "Blocked" : "Warning"}:</span> {f.rule.replace(/_/g, " ").toLowerCase()}
          {f.field ? ` — ${f.field}` : ""} <span className="text-muted">({f.snippet})</span>
        </li>
      ))}
    </ul>
  );
}

export function RoiNote() {
  return <p className="text-xs text-muted">Return on investment is shown only when spend is provider-verified and attributed revenue exists; otherwise: &ldquo;Insufficient verified data for ROI calculation.&rdquo;</p>;
}
