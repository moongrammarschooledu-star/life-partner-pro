"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { ApprovalNote, ChangeDialog, CcHeader, StatusPill, Table, fmt, sendChange } from "@/components/admin/platform/cc-shared";

interface Target { type: string; values?: string[] }
interface Flag { key: string; description: string; sensitive: boolean; managedElsewhere?: string; state: string; rolloutPercent: number | null; targets: Target[]; version: number; reason: string | null; updatedAt: string | null; isDefault: boolean }
interface KillSwitch { key: string; label: string; mechanism: string; effect: string; engaged: boolean | null; href?: string }
interface Features {
  environment: string;
  states: string[];
  targetTypes: string[];
  items: Flag[];
  specFlags: Array<{ specKey: string; mapsTo?: string; emergencySwitch?: string; enforced: boolean; note: string }>;
  killSwitches: KillSwitch[];
  canManage: boolean;
  propagationNote: string;
}

const STATE_HELP: Record<string, string> = {
  DISABLED: "Off for everyone.",
  ENABLED: "On for everyone.",
  ROLLOUT: "On only for the chosen percentage and groups.",
  PAUSED: "Held off while you decide; nothing is removed.",
  EMERGENCY_DISABLED: "Switched off in an emergency; stays off until someone deliberately turns it back on.",
};

function summarise(f: Flag): string {
  if (f.state !== "ROLLOUT") return STATE_HELP[f.state] ?? "";
  const parts: string[] = [];
  if (f.rolloutPercent != null) parts.push(`${f.rolloutPercent}% of people`);
  for (const t of f.targets) parts.push(t.values?.length ? `${t.type.toLowerCase().replace(/_/g, " ")}: ${t.values.join(", ")}` : t.type.toLowerCase().replace(/_/g, " "));
  return parts.length ? `On for ${parts.join("; ")}.` : "No audience chosen yet, so nobody has it.";
}

export function FeaturesClient({ permissions }: { permissions: string[] }) {
  const { data, error, loading, reload } = useApi<Features>("/api/admin/platform/features");
  const { show } = useToast();
  const [editing, setEditing] = useState<Flag | null>(null);
  const [state, setState] = useState("DISABLED");
  const [percent, setPercent] = useState("");
  const [targetType, setTargetType] = useState("");
  const [targetValues, setTargetValues] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [approval, setApproval] = useState<string | null>(null);
  const [ks, setKs] = useState<{ item: KillSwitch; engage: boolean } | null>(null);
  const [filter, setFilter] = useState("");

  function open(f: Flag) {
    setEditing(f);
    setState(f.state);
    setPercent(f.rolloutPercent == null ? "" : String(f.rolloutPercent));
    const t = f.targets[0];
    setTargetType(t?.type ?? "");
    setTargetValues(t?.values?.join(", ") ?? "");
  }

  function body() {
    const targets = targetType ? [{ type: targetType, ...(targetValues.trim() ? { values: targetValues.split(",").map((v) => v.trim()).filter(Boolean) } : {}) }] : [];
    return { state, rolloutPercent: state === "ROLLOUT" && percent.trim() !== "" ? Number(percent) : null, targets: state === "ROLLOUT" ? targets : [] };
  }

  const shown = (data?.items ?? []).filter((f) => !filter || f.key.includes(filter.toLowerCase()) || f.state.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <CcHeader title="Feature flags" description="Switch features on, off, or roll them out to a share of people. Turning something off never needs approval; turning a sensitive feature on in production does." permissions={permissions} environment={data?.environment} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {approval && <ApprovalNote code={approval} onClose={() => setApproval(null)} />}
      {data && (
        <>
          <Card title="Emergency switches">
            <p className="mb-3 text-sm text-muted">Engaging a switch stops NEW activity of that kind. Nothing is deleted, and releasing it restores normal behaviour.</p>
            <Table head={["Switch", "Effect", "State", ""]}>
              {data.killSwitches.map((k) => (
                <tr key={k.key} className="align-top">
                  <td className="px-2 py-2 font-medium">{k.label}</td>
                  <td className="px-2 py-2 text-muted">{k.effect}</td>
                  <td className="px-2 py-2">{k.engaged === null || k.mechanism === "external" ? <Badge variant="muted">{k.engaged ? "engaged · own workflow" : "own workflow"}</Badge> : k.engaged ? <Badge variant="danger">engaged</Badge> : <Badge variant="success">released</Badge>}</td>
                  <td className="px-2 py-2 text-right">
                    {k.engaged !== null && k.mechanism !== "external" && permissions.includes("platform:features:manage") && <Button size="sm" variant={k.engaged ? "outline" : "danger"} onClick={() => setKs({ item: k, engage: !k.engaged })}>{k.engaged ? "Release" : "Engage"}</Button>}
                    {k.href && <Link href={k.href} className="ml-2 text-sm text-primary hover:underline">Open</Link>}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Feature flags" action={<Input aria-label="Filter flags" placeholder="Filter…" className="h-8 w-40" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
            <p className="mb-3 text-xs text-muted">{data.propagationNote}</p>
            <Table head={["Feature", "State", "Who has it", "Version", "Changed", ""]}>
              {shown.map((f) => (
                <tr key={f.key} className="align-top">
                  <td className="px-2 py-2"><span className="font-mono text-xs">{f.key}</span><p className="text-xs text-muted">{f.description}{f.sensitive ? " · sensitive" : ""}</p></td>
                  <td className="px-2 py-2"><StatusPill status={f.state} /></td>
                  <td className="px-2 py-2 text-muted">{f.managedElsewhere ? `Managed in ${f.managedElsewhere}` : summarise(f)}</td>
                  <td className="px-2 py-2 text-muted">{f.isDefault ? "default" : `v${f.version}`}</td>
                  <td className="px-2 py-2 text-muted">{fmt(f.updatedAt)}</td>
                  <td className="px-2 py-2 text-right">{data.canManage && !f.managedElsewhere && <Button size="sm" variant="outline" onClick={() => open(f)}>Change</Button>}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Features named in the brief that the application does not switch yet">
            <p className="mb-2 text-sm text-muted">These are listed so nothing looks controllable that is not. They have no switch because the application does not check one.</p>
            <Table head={["Feature", "Status", "Note"]}>
              {data.specFlags.filter((s) => !s.enforced).map((s) => <tr key={s.specKey}><td className="px-2 py-2 font-mono text-xs">{s.specKey}</td><td className="px-2 py-2"><StatusPill status="NOT_ENFORCED" /></td><td className="px-2 py-2 text-muted">{s.note}</td></tr>)}
            </Table>
          </Card>
        </>
      )}

      {editing && !confirm && (
        <div role="dialog" aria-modal="true" aria-label={`Change ${editing.key}`} className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-border bg-surface p-5">
            <h2 className="text-lg font-semibold">{editing.key}</h2>
            <p className="text-sm text-muted">{editing.description}</p>
            <Field label="State" hint={STATE_HELP[state]} htmlFor="flag-state">
              <Select id="flag-state" value={state} onChange={(e) => setState(e.target.value)}>{(data?.states ?? []).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
            </Field>
            {state === "ROLLOUT" && (
              <>
                <Field label="Percentage of people (0 to 100)" hint="The same person always gets the same answer. Leave empty to use groups only." htmlFor="flag-percent"><Input id="flag-percent" type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} /></Field>
                <Field label="Group (optional)" hint="People outside the group never get it during a rollout." htmlFor="flag-target">
                  <Select id="flag-target" value={targetType} onChange={(e) => setTargetType(e.target.value)}><option value="">No group</option>{(data?.targetTypes ?? []).map((t) => <option key={t} value={t}>{t.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
                </Field>
                {(targetType === "SPECIFIC_ROLE" || targetType === "SPECIFIC_USER" || targetType === "COUNTRY" || targetType === "ENVIRONMENT") && (
                  <Field label="Values (comma separated)" hint="Roles, administrator ids, countries or environments. No personal traits are used for targeting." htmlFor="flag-values"><Input id="flag-values" value={targetValues} onChange={(e) => setTargetValues(e.target.value)} /></Field>
                )}
              </>
            )}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => setConfirm(true)}>Continue</Button></div>
          </div>
        </div>
      )}

      <ChangeDialog
        open={confirm && editing !== null}
        title={editing ? `Change ${editing.key}` : "Change feature"}
        description={editing?.sensitive ? "This is a sensitive feature. Switching it on in production needs a second administrator's approval." : "The change is recorded with its reason and can be rolled back from the history."}
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setConfirm(false)}
        submit={async ({ reason, stepUpToken, environment }) => {
          if (!editing) return null;
          const res = await sendChange(`/api/admin/platform/features/${encodeURIComponent(editing.key)}`, "PATCH", { ...body(), reason, environment, stepUpToken });
          if (res.error) return res.error;
          if (res.approvalCode) setApproval(res.approvalCode);
          else show("Feature updated.", "success");
          setConfirm(false);
          setEditing(null);
          reload();
          return null;
        }}
      />
      <ChangeDialog
        open={ks !== null}
        danger={ks?.engage}
        title={ks ? `${ks.engage ? "Engage" : "Release"}: ${ks.item.label}` : "Emergency switch"}
        description={ks?.engage ? "This stops new activity of that kind straight away. Nothing is deleted." : "This restores normal behaviour."}
        environment={data?.environment ?? "PRODUCTION"}
        onCancel={() => setKs(null)}
        submit={async ({ reason, stepUpToken, environment }) => {
          if (!ks) return null;
          const res = await sendChange("/api/admin/platform/kill-switches", "POST", { key: ks.item.key, engage: ks.engage, reason, environment, stepUpToken });
          if (res.error) return res.error;
          if (res.approvalCode) setApproval(res.approvalCode);
          else show(ks.engage ? "Switch engaged." : "Switch released.", "success");
          setKs(null);
          reload();
          return null;
        }}
      />
    </div>
  );
}
