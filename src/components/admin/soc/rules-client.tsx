"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Card, ErrorNote, Loading, SensitiveActionDialog, callApi, useApi } from "@/components/admin/system/shared";
import { SeverityBadge, SocHeader, Source, Table, fmt, makeCan } from "@/components/admin/soc/shared";

interface Cfg { enabled: boolean; severity: string; threshold: number; windowMinutes: number }
interface Rule { key: string; name: string; category: string; description: string; source: string; unit: string; protectedRule: boolean; defaults: Cfg; active: Cfg & { version: number }; proposed: (Cfg & { version: number; authorId: string | null; changeReason: string; createdAt: string }) | null }
interface DryRun { findings: number; sample: Array<{ resource: string; observed: number; summary: string }>; truncated: boolean; config: Cfg; from: string; to: string }

export function RulesClient({ permissions, adminId }: { permissions: string[]; adminId: string }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: Rule[] }>("/api/admin/soc/rules");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Cfg>({ enabled: true, severity: "MEDIUM", threshold: 5, windowMinutes: 60 });
  const [dry, setDry] = useState<{ key: string; result: DryRun } | null>(null);
  const [save, setSave] = useState<string | null>(null);
  const [review, setReview] = useState<{ key: string; decision: "APPROVE" | "REJECT" } | null>(null);

  function startEdit(r: Rule) {
    setEditing(r.key);
    setDraft({ enabled: r.active.enabled, severity: r.active.severity, threshold: r.active.threshold, windowMinutes: r.active.windowMinutes });
    setDry(null);
  }
  async function dryRun(key: string) {
    const res = await callApi<DryRun>(`/api/admin/soc/rules/${encodeURIComponent(key)}/dry-run`, "POST", { days: 7, config: { threshold: draft.threshold, windowMinutes: draft.windowMinutes, severity: draft.severity } });
    if (!res.ok) return show(res.data.error ?? "The test could not run.", "error");
    setDry({ key, result: res.data });
  }

  return (
    <div className="space-y-4">
      <SocHeader title="Detection rules" description="Each rule counts a kind of event inside a time window and raises an alert when a threshold is reached. A rule's definition is fixed in code; its threshold, window and severity are versioned here. Test a change against the past 7 days before saving — the test creates nothing. Making a high-severity or protected rule quieter needs a different person to approve it." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <Card>
          <Table head={["Rule", "Reads", "Threshold", "Window", "Severity", "Version", ""]}>
            {data.items.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="px-2 py-2"><div className="font-medium">{r.name} {r.protectedRule && <Badge variant="info">protected</Badge>} {!r.active.enabled && <Badge variant="muted">off</Badge>}</div><div className="text-xs text-muted">{r.description}</div><div className="text-xs text-muted">{r.key}</div></td>
                <td className="px-2 py-2 text-muted">{r.source}<div className="text-xs">counts {r.unit}</div></td>
                <td className="px-2 py-2">{r.active.threshold}<div className="text-xs text-muted">default {r.defaults.threshold}</div></td>
                <td className="px-2 py-2">{r.active.windowMinutes} min</td>
                <td className="px-2 py-2"><SeverityBadge severity={r.active.severity} /></td>
                <td className="px-2 py-2">v{r.active.version || "default"}</td>
                <td className="px-2 py-2">
                  <div className="flex flex-col gap-1">
                    {can("soc:rules:view") && <Button size="sm" variant="outline" onClick={() => startEdit(r)}>Test / edit</Button>}
                    {r.proposed && <div className="rounded-lg bg-warning/10 p-2 text-xs">Change waiting for review: threshold {r.proposed.threshold}, {r.proposed.windowMinutes} min, {r.proposed.severity}{r.proposed.enabled ? "" : ", switched off"} (“{r.proposed.changeReason}”, {fmt(r.proposed.createdAt)})
                      {can("soc:rules:manage") && r.proposed.authorId !== adminId && <div className="mt-1 flex gap-1"><Button size="sm" onClick={() => setReview({ key: r.key, decision: "APPROVE" })}>Approve</Button><Button size="sm" variant="outline" onClick={() => setReview({ key: r.key, decision: "REJECT" })}>Reject</Button></div>}
                      {r.proposed.authorId === adminId && <div className="mt-1 text-muted">You proposed this; someone else must review it.</div>}</div>}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
          <Source>SocDetectionRule, SocRuleVersion</Source>
        </Card>
      )}

      {editing && data && (
        <Card title={`Try or change: ${data.items.find((r) => r.key === editing)?.name}`}>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Threshold" htmlFor="r-th"><Input id="r-th" type="number" min={1} value={draft.threshold} onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })} /></Field>
            <Field label="Window (minutes)" htmlFor="r-win"><Input id="r-win" type="number" min={5} value={draft.windowMinutes} onChange={(e) => setDraft({ ...draft, windowMinutes: Number(e.target.value) })} /></Field>
            <Field label="Severity" htmlFor="r-sev"><Select id="r-sev" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>{["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Rule is" htmlFor="r-en"><Select id="r-en" value={draft.enabled ? "on" : "off"} onChange={(e) => setDraft({ ...draft, enabled: e.target.value === "on" })}><option value="on">On</option><option value="off">Off</option></Select></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => dryRun(editing)}>Test against the last 7 days</Button>
            {can("soc:rules:manage") && <Button onClick={() => setSave(editing)}>Save as a new version</Button>}
            <Button variant="ghost" onClick={() => { setEditing(null); setDry(null); }}>Close</Button>
          </div>
          {dry && dry.key === editing && (
            <div className="mt-4 rounded-lg bg-surface-muted p-3 text-sm">
              <p className="font-medium">With these settings the rule would have raised {dry.result.findings} alert(s) between {fmt(dry.result.from)} and {fmt(dry.result.to)}.</p>
              {dry.result.truncated && <p className="text-warning">The read hit its size cap, so the real count may be higher.</p>}
              <ul className="mt-2 list-disc pl-5 text-muted">{dry.result.sample.map((s, i) => <li key={i}>{s.resource}: {s.summary}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">Nothing was created or changed.</p>
            </div>
          )}
        </Card>
      )}

      <SensitiveActionDialog
        open={!!save}
        title="Save this rule change"
        description="This creates a new version. If it makes a high-severity or protected rule quieter, it waits for a different person to approve it."
        onCancel={() => setSave(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const res = await callApi<{ status?: string }>(`/api/admin/soc/rules/${encodeURIComponent(save!)}`, "PATCH", { patch: draft, reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "The change was not saved.";
          show(res.data.status === "PROPOSED" ? "Saved. It takes effect once someone else approves it." : "Saved and in force.", "success");
          setSave(null);
          setEditing(null);
          reload();
        }}
      />
      <SensitiveActionDialog
        open={!!review}
        title={review?.decision === "APPROVE" ? "Approve this rule change" : "Reject this rule change"}
        description="A change cannot be reviewed by the person who proposed it."
        onCancel={() => setReview(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const res = await callApi(`/api/admin/soc/rules/${encodeURIComponent(review!.key)}/review`, "POST", { decision: review!.decision, note: reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "The review was not recorded.";
          show(review!.decision === "APPROVE" ? "Approved — now in force." : "Rejected.", "success");
          setReview(null);
          reload();
        }}
      />
    </div>
  );
}
