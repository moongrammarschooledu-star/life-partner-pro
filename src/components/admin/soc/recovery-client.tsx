"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, KV, Loading, SensitiveActionDialog, StatusBadge, callApi, formatBytes, useApi } from "@/components/admin/system/shared";
import { SocHeader, Source, Stat, Table, fmt, makeCan, minutesLabel } from "@/components/admin/soc/shared";

// ---------------------------------------------------------------- Backups
interface BackupRun { id: string; code: string; type: string; trigger: string; status: string; startedAt: string; sizeBytes: number | null; encrypted: boolean; storedOffsite: boolean; separateStore: boolean; verification: string | null; failureReason: string | null; retentionClass: string }
interface BackupData {
  enabled: boolean; health: string; reasons: string[]; latestDatabase: BackupRun | null; latestFiles: BackupRun | null; lastVerified: BackupRun | null;
  counts: { failedLast30Days: number; running: number }; retention: { daily: number; weekly: number; monthly: number; staleAfterHours: number };
  storage: { encrypted: boolean | null; offsite: boolean | null; separateStore: boolean | null; note: string }; recent: BackupRun[]; verificationNote: string;
  restoreVerifications: Array<{ id: string; status: string; startedAt: string }>;
}

export function BackupsClient({ permissions }: { permissions: string[] }) {
  const can = makeCan(permissions);
  const { data, error, loading } = useApi<BackupData>("/api/admin/soc/backups");
  return (
    <div className="space-y-4">
      <SocHeader title="Backups" description="The state of backups exactly as the backup records say it is. “Healthy” is shown only when a backup completed, passed its integrity verification and is within the age limit. Backup locations and keys are never shown." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Backup status" value={<StatusBadge status={data.health} />} />
            <Stat label="Last backup" value={data.latestDatabase ? fmt(data.latestDatabase.startedAt) : "None yet"} hint={data.latestDatabase?.code} />
            <Stat label="Last verified backup" value={data.lastVerified ? fmt(data.lastVerified.startedAt) : "None yet"} hint={data.lastVerified?.code} />
            <Stat label="Failed in 30 days" value={data.counts.failedLast30Days} tone={data.counts.failedLast30Days ? "warning" : undefined} />
          </div>
          {data.reasons.length > 0 && <Card title="Why this status"><ul className="list-disc pl-5 text-sm">{data.reasons.map((r) => <li key={r}>{r}</li>)}</ul></Card>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Storage and retention">
              <dl>
                <KV label="Encrypted before storage">{data.storage.encrypted === null ? "No backup yet" : data.storage.encrypted ? "Yes" : "No"}</KV>
                <KV label="Stored off-site">{data.storage.offsite === null ? "No backup yet" : data.storage.offsite ? "Yes" : "No (local copy only)"}</KV>
                <KV label="Separate backup store">{data.storage.separateStore === null ? "No backup yet" : data.storage.separateStore ? "Yes" : "No"}</KV>
                <KV label="Keep daily / weekly / monthly">{data.retention.daily} / {data.retention.weekly} / {data.retention.monthly}</KV>
                <KV label="Flag as stale after">{data.retention.staleAfterHours} hours</KV>
              </dl>
              <p className="mt-2 text-xs text-muted">{data.storage.note}</p>
              <p className="mt-1 text-xs text-muted">Backups are removed only by the retention policy. Any other attempt to delete one is refused and raises an alert.</p>
            </Card>
            <Card title="What a verification proves">
              <p className="text-sm">{data.verificationNote}</p>
              <p className="mt-2 text-sm text-muted">Use Restore drills to rehearse a restore into an isolated environment and record the result.</p>
            </Card>
          </div>
          <Card title="Recent backup runs">
            {data.recent.length === 0 ? <EmptyState title="No backup has run yet" /> : (
              <Table head={["Backup", "Type", "Trigger", "Status", "Verified", "Size", "Started"]}>
                {data.recent.map((b) => <tr key={b.id}><td className="px-2 py-2">{b.code}{b.failureReason && <div className="text-xs text-danger">{b.failureReason}</div>}</td><td className="px-2 py-2 text-muted">{b.type.toLowerCase()}</td><td className="px-2 py-2 text-muted">{b.trigger.toLowerCase()}</td><td className="px-2 py-2"><StatusBadge status={b.status} /></td><td className="px-2 py-2">{b.verification ? <StatusBadge status={b.verification} /> : <span className="text-muted">not yet</span>}</td><td className="px-2 py-2 text-muted">{formatBytes(b.sizeBytes)}</td><td className="px-2 py-2 text-muted">{fmt(b.startedAt)}</td></tr>)}
              </Table>
            )}
            <Source>BackupRun</Source>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Restore drills
interface DrillItem { key: string; status: string; note: string }
interface Drill { id: string; backupCode: string | null; environmentLabel: string; status: string; items: DrillItem[]; verifySummary: { passed?: boolean; checks?: number } | null; startedAt: string; completedAt: string | null; durationSeconds: number | null; performedById: string; reviewedById: string | null; reviewedAt: string | null; reviewNote: string | null; failureNote: string | null }

export function RestoreDrillsClient({ permissions, adminId }: { permissions: string[]; adminId: string }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<{ items: Drill[]; proof: { hasProof: boolean; lastProven: { completedAt: string | null; durationSeconds: number | null; environmentLabel: string } | null; ageDays: number | null }; checklist: Array<{ key: string; label: string }> }>("/api/admin/soc/restore-drills");
  const backups = useApi<BackupData>("/api/admin/soc/backups");
  const [start, setStart] = useState({ backupId: "", environmentLabel: "", isolatedConfirmed: false });
  const [review, setReview] = useState<{ id: string; decision: "APPROVE" | "REJECT" } | null>(null);
  const [item, setItem] = useState<Record<string, { status: string; note: string }>>({});

  async function begin() {
    const res = await callApi("/api/admin/soc/restore-drills", "POST", start);
    if (!res.ok) return show(res.data.error ?? "The drill did not start.", "error");
    show("Drill started. The automated verification has run; now restore into the isolated environment and record each check.", "success");
    reload();
  }
  async function record(drillId: string, key: string) {
    const v = item[`${drillId}:${key}`];
    if (!v) return;
    const res = await callApi(`/api/admin/soc/restore-drills/${drillId}`, "PATCH", { action: "ITEM", key, status: v.status, note: v.note });
    if (!res.ok) return show(res.data.error ?? "Not recorded.", "error");
    show("Recorded.", "success");
    reload();
  }
  async function complete(drillId: string, failureNote: string) {
    const res = await callApi(`/api/admin/soc/restore-drills/${drillId}`, "PATCH", { action: "COMPLETE", failureNote });
    if (!res.ok) return show(res.data.error ?? "The drill could not be completed.", "error");
    show("Drill completed — waiting for a second person to review it.", "success");
    reload();
  }

  const mine = data?.items.find((d) => d.status === "IN_PROGRESS" && d.performedById === adminId);
  return (
    <div className="space-y-4">
      <SocHeader title="Restore drills" description="A backup that has never been restored is a hope, not a backup. A drill records a restore into an isolated environment, step by step, and a second person signs it off. The application never restores into production and never writes backup data anywhere." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {data && (
        <>
          <Card title="Is a restore proven?">
            {data.proof.hasProof ? <p className="text-sm">Yes. An approved drill passed on {fmt(data.proof.lastProven?.completedAt)} ({data.proof.ageDays} day(s) ago) in “{data.proof.lastProven?.environmentLabel}”, taking {minutesLabel(data.proof.lastProven?.durationSeconds ? Math.ceil(data.proof.lastProven.durationSeconds / 60) : null)}.</p> : <p className="text-sm">No. No restore drill has been completed and approved yet. A verified backup is not proof that a restore works.</p>}
            <div className="mt-3 rounded-lg bg-surface-muted p-3 text-sm">
              <p className="font-medium">How to run a drill</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted">
                <li>Create an empty, isolated database (for example a separate Neon branch) — never the live one.</li>
                <li>Start a drill here with that environment’s name. The backup is verified automatically (decrypt, checksum, row counts).</li>
                <li>On a trusted machine run <code>scripts/restore-backup.ts</code> with the backup file and the isolated database as its target. It refuses to write to the live database unless explicitly forced.</li>
                <li>Check the restored data and record each of the eight checks below, with a short note of how you checked.</li>
                <li>Complete the drill. A different administrator then reviews and signs it off.</li>
              </ol>
            </div>
          </Card>

          {can("soc:restore:record") && !mine && (
            <Card title="Start a drill">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Backup to restore" htmlFor="d-backup"><Select id="d-backup" value={start.backupId} onChange={(e) => setStart({ ...start, backupId: e.target.value })}><option value="">Choose a completed database backup…</option>{(backups.data?.recent ?? []).filter((b) => b.type === "DATABASE" && b.status === "COMPLETED").map((b) => <option key={b.id} value={b.id}>{b.code} — {fmt(b.startedAt)}</option>)}</Select></Field>
                <Field label="Isolated environment name" hint="For example “neon-branch restore-oct”. It cannot refer to production or the live system." htmlFor="d-env"><Input id="d-env" value={start.environmentLabel} onChange={(e) => setStart({ ...start, environmentLabel: e.target.value })} /></Field>
                <label className="flex items-start gap-2 text-sm md:col-span-2"><input type="checkbox" className="mt-1" checked={start.isolatedConfirmed} onChange={(e) => setStart({ ...start, isolatedConfirmed: e.target.checked })} />I confirm the restore will be into an isolated environment, not production.</label>
                <div><Button onClick={begin} disabled={!start.backupId || start.environmentLabel.trim().length < 3 || !start.isolatedConfirmed}>Start drill</Button></div>
              </div>
            </Card>
          )}

          {mine && (
            <Card title={`In progress — ${mine.backupCode} → ${mine.environmentLabel}`}>
              <p className="mb-2 text-sm">Automated verification: {mine.verifySummary?.passed ? "passed" : "FAILED"} ({mine.verifySummary?.checks ?? 0} checks). The checklist below is your own attestation; the application cannot perform these steps.</p>
              <Table head={["Check", "Result", "How it was checked", ""]}>
                {data.checklist.map((c) => {
                  const cur = mine.items.find((i) => i.key === c.key)!;
                  const v = item[`${mine.id}:${c.key}`] ?? { status: cur.status, note: cur.note };
                  return (
                    <tr key={c.key}>
                      <td className="px-2 py-2">{c.label}</td>
                      <td className="px-2 py-2"><Select aria-label={`Result for ${c.label}`} value={v.status} onChange={(e) => setItem({ ...item, [`${mine.id}:${c.key}`]: { ...v, status: e.target.value } })}><option value="NOT_RUN">Not run</option><option value="PASSED">Passed</option><option value="FAILED">Failed</option></Select></td>
                      <td className="px-2 py-2"><Input aria-label={`Note for ${c.label}`} value={v.note} onChange={(e) => setItem({ ...item, [`${mine.id}:${c.key}`]: { ...v, note: e.target.value } })} /></td>
                      <td className="px-2 py-2"><Button size="sm" variant="outline" onClick={() => record(mine.id, c.key)}>Save</Button></td>
                    </tr>
                  );
                })}
              </Table>
              <CompleteBox onComplete={(n) => complete(mine.id, n)} />
            </Card>
          )}

          <Card title="All drills">
            {data.items.length === 0 ? <EmptyState title="No drills yet" description="Until one is completed and approved, a restore is not proven." /> : (
              <Table head={["Backup", "Environment", "Status", "Duration", "Performed by", "Reviewed", ""]}>
                {data.items.map((d) => (
                  <tr key={d.id} className="align-top">
                    <td className="px-2 py-2">{d.backupCode ?? "—"}<div className="text-xs text-muted">{fmt(d.startedAt)}</div></td>
                    <td className="px-2 py-2 text-muted">{d.environmentLabel}</td>
                    <td className="px-2 py-2"><StatusBadge status={d.status} />{d.failureNote && <div className="text-xs text-danger">{d.failureNote}</div>}</td>
                    <td className="px-2 py-2 text-muted">{d.durationSeconds ? minutesLabel(Math.ceil(d.durationSeconds / 60)) : "—"}</td>
                    <td className="px-2 py-2 text-muted">{d.performedById === adminId ? "you" : d.performedById}</td>
                    <td className="px-2 py-2 text-muted">{d.reviewedAt ? `${fmt(d.reviewedAt)} by ${d.reviewedById}` : d.status === "IN_PROGRESS" ? "—" : "waiting"}{d.reviewNote && <div className="text-xs">{d.reviewNote}</div>}</td>
                    <td className="px-2 py-2">{can("soc:restore:review") && d.status !== "IN_PROGRESS" && !d.reviewedAt && d.performedById !== adminId && <div className="flex gap-1"><Button size="sm" onClick={() => setReview({ id: d.id, decision: "APPROVE" })} disabled={d.status !== "PASSED"}>Approve</Button><Button size="sm" variant="outline" onClick={() => setReview({ id: d.id, decision: "REJECT" })}>Reject</Button></div>}</td>
                  </tr>
                ))}
              </Table>
            )}
            <Source>RestoreDrill</Source>
          </Card>
        </>
      )}
      <SensitiveActionDialog
        open={!!review}
        title={review?.decision === "APPROVE" ? "Approve this restore drill" : "Reject this restore drill"}
        description="You are confirming you reviewed the evidence. A drill cannot be reviewed by the person who performed it."
        onCancel={() => setReview(null)}
        onConfirm={async ({ reason, stepUpToken }) => {
          const res = await callApi(`/api/admin/soc/restore-drills/${review!.id}/review`, "POST", { decision: review!.decision, note: reason, stepUpToken });
          if (!res.ok) return res.data.error ?? "The review was not recorded.";
          show("Review recorded.", "success");
          setReview(null);
          reload();
        }}
      />
    </div>
  );
}

function CompleteBox({ onComplete }: { onComplete: (failureNote: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <Field label="If anything failed, summarise what" htmlFor="d-fail"><Textarea id="d-fail" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button onClick={() => onComplete(note)}>Complete drill</Button>
      <p className="text-xs text-muted">A drill cannot be completed while a check is “not run”, and it can only pass when every check passed and the automated verification passed.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Disaster recovery
const SECTIONS: Array<[string, string]> = [["procedures", "Recovery procedures"], ["infrastructure", "Infrastructure dependencies"], ["providers", "Provider dependencies"], ["contacts", "Recovery contacts (roles and names — never passwords)"], ["failover", "Failover procedure"], ["rollback", "Rollback procedure"], ["businessContinuity", "Business continuity"]];
interface DrData {
  overview: {
    configured: { rtoMinutes: number; rpoMinutes: number; note: string };
    measured: { rpoMinutes: number | null; rpoBasis: string; rtoMinutes: number | null; rtoBasis: string; note: string };
    comparison: { rpo: string; rto: string };
    plan: { version: number; approvedAt: string | null; testEveryDays: number | null; counts: Record<string, number>; infrastructure: Array<{ title: string; detail: string }>; providers: Array<{ title: string; detail: string }> } | null;
    tests: { everyDays: number | null; lastTestAt: string | null; nextDueAt: string | null; overdue: boolean; recent: Array<{ id: string; testType: string; status: string; performedAt: string | null; durationMinutes: number | null; findings: string | null }> };
  };
  plans: Array<{ id: string; version: number; status: string; changeReason: string; authorId: string; createdAt: string; sections: Record<string, Array<{ title: string; detail: string }>> }>;
}

export function DisasterRecoveryClient({ permissions, adminId }: { permissions: string[]; adminId: string }) {
  const can = makeCan(permissions);
  const { show } = useToast();
  const { data, error, loading, reload } = useApi<DrData>("/api/admin/soc/disaster-recovery");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [testEvery, setTestEvery] = useState("90");
  const [approve, setApprove] = useState<number | null>(null);
  const [test, setTest] = useState({ testType: "TABLETOP", status: "COMPLETED", performedAt: "", durationMinutes: "", findings: "" });

  function parseSection(text: string): Array<{ title: string; detail: string }> {
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [title, ...rest] = l.split("|"); return { title: title.trim(), detail: rest.join("|").trim() }; });
  }
  async function saveDraft() {
    const sections = Object.fromEntries(SECTIONS.map(([k]) => [k, parseSection(draft[k] ?? "")]));
    const res = await callApi("/api/admin/soc/disaster-recovery", "POST", { action: "DRAFT", sections, reason, testEveryDays: testEvery ? Number(testEvery) : null });
    if (!res.ok) return show(res.data.error ?? "The draft was not saved.", "error");
    show("Draft saved. Someone other than you must approve it.", "success");
    reload();
  }
  async function recordTest() {
    const res = await callApi("/api/admin/soc/disaster-recovery", "POST", { action: "TEST", ...test, performedAt: test.performedAt ? new Date(test.performedAt).toISOString() : "", durationMinutes: test.durationMinutes ? Number(test.durationMinutes) : null });
    if (!res.ok) return show(res.data.error ?? "The test was not recorded.", "error");
    show("Test recorded.", "success");
    reload();
  }

  const o = data?.overview;
  const draftPlan = data?.plans.find((p) => p.status === "DRAFT");
  return (
    <div className="space-y-4">
      <SocHeader title="Disaster recovery" description="The recovery plan, the objectives you have set, and what the records actually show. Targets and measurements are kept apart: a measurement is never filled in from the target, and no recovery time is promised." can={can} />
      {loading && <Loading />}
      {error && <ErrorNote message={error} />}
      {o && data && (
        <>
          <Card title="Objectives: configured versus measured">
            <Table head={["", "Configured (target)", "Measured", "Result", "Basis for the measurement"]}>
              <tr><td className="px-2 py-2">Recovery point (RPO)</td><td className="px-2 py-2">{minutesLabel(o.configured.rpoMinutes)}</td><td className="px-2 py-2">{minutesLabel(o.measured.rpoMinutes)}</td><td className="px-2 py-2"><StatusBadge status={o.comparison.rpo === "MET" ? "PASS" : o.comparison.rpo === "EXCEEDED" ? "FAIL" : "WARN"} /> <span className="text-xs text-muted">{o.comparison.rpo.replace(/_/g, " ").toLowerCase()}</span></td><td className="px-2 py-2 text-muted">{o.measured.rpoBasis}</td></tr>
              <tr><td className="px-2 py-2">Recovery time (RTO)</td><td className="px-2 py-2">{minutesLabel(o.configured.rtoMinutes)}</td><td className="px-2 py-2">{minutesLabel(o.measured.rtoMinutes)}</td><td className="px-2 py-2"><StatusBadge status={o.comparison.rto === "MET" ? "PASS" : o.comparison.rto === "EXCEEDED" ? "FAIL" : "WARN"} /> <span className="text-xs text-muted">{o.comparison.rto.replace(/_/g, " ").toLowerCase()}</span></td><td className="px-2 py-2 text-muted">{o.measured.rtoBasis}</td></tr>
            </Table>
            <p className="mt-2 text-xs text-muted">{o.configured.note} {o.measured.note} Change the targets in System Control.</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Approved plan">
              {o.plan ? (
                <>
                  <p className="text-sm">Version {o.plan.version}, approved {fmt(o.plan.approvedAt)}. Test every {o.plan.testEveryDays ?? "—"} days.</p>
                  <dl className="mt-2">{SECTIONS.map(([k, label]) => <KV key={k} label={label}>{o.plan!.counts[k] ?? 0} item(s)</KV>)}</dl>
                </>
              ) : <EmptyState title="No approved plan" description="Write a plan below; a different administrator then approves it." />}
              {o.plan && o.plan.infrastructure.length + o.plan.providers.length > 0 && (
                <div className="mt-3 text-sm"><p className="font-medium">Dependencies</p><ul className="list-disc pl-5 text-muted">{[...o.plan.infrastructure, ...o.plan.providers].map((d, i) => <li key={i}>{d.title}{d.detail ? ` — ${d.detail}` : ""}</li>)}</ul></div>
              )}
            </Card>
            <Card title="Recovery tests">
              <p className="text-sm">Last test: {fmt(o.tests.lastTestAt)} · Next due: {o.tests.everyDays ? fmt(o.tests.nextDueAt) : "no schedule set"} {o.tests.overdue && <StatusBadge status="WARN" />}</p>
              {o.tests.recent.length === 0 ? <p className="mt-2 text-sm text-muted">No test has been recorded.</p> : <Table head={["Type", "Result", "When", "Findings"]}>{o.tests.recent.map((t) => <tr key={t.id}><td className="px-2 py-2">{t.testType.toLowerCase()}</td><td className="px-2 py-2"><StatusBadge status={t.status} /></td><td className="px-2 py-2 text-muted">{fmt(t.performedAt)}</td><td className="px-2 py-2 text-muted">{t.findings}</td></tr>)}</Table>}
              {can("soc:dr:manage") && (
                <div className="mt-3 grid gap-2 border-t border-border pt-3 md:grid-cols-2">
                  <Select aria-label="Test type" value={test.testType} onChange={(e) => setTest({ ...test, testType: e.target.value })}><option value="TABLETOP">Tabletop walkthrough</option><option value="RESTORE">Restore</option><option value="FAILOVER">Failover</option></Select>
                  <Select aria-label="Result" value={test.status} onChange={(e) => setTest({ ...test, status: e.target.value })}><option value="COMPLETED">Completed</option><option value="FAILED">Failed</option></Select>
                  <Input aria-label="When it was performed" type="datetime-local" value={test.performedAt} onChange={(e) => setTest({ ...test, performedAt: e.target.value })} />
                  <Input aria-label="Duration in minutes" type="number" placeholder="Minutes (optional)" value={test.durationMinutes} onChange={(e) => setTest({ ...test, durationMinutes: e.target.value })} />
                  <Textarea aria-label="What was tested and found" className="md:col-span-2" rows={2} placeholder="What was tested and what was found" value={test.findings} onChange={(e) => setTest({ ...test, findings: e.target.value })} />
                  <div><Button size="sm" onClick={recordTest} disabled={!test.performedAt || test.findings.trim().length < 10}>Record test</Button></div>
                </div>
              )}
            </Card>
          </div>

          {draftPlan && (
            <Card title={`Draft version ${draftPlan.version} — waiting for approval`}>
              <p className="text-sm text-muted">Written by {draftPlan.authorId === adminId ? "you" : draftPlan.authorId} on {fmt(draftPlan.createdAt)}: {draftPlan.changeReason}</p>
              {can("soc:dr:manage") && draftPlan.authorId !== adminId ? <Button className="mt-2" onClick={() => setApprove(draftPlan.version)}>Review and approve</Button> : <p className="mt-2 text-sm text-muted">{draftPlan.authorId === adminId ? "A different administrator must approve it." : ""}</p>}
            </Card>
          )}

          {can("soc:dr:manage") && !draftPlan && (
            <Card title="Write a new plan version">
              <p className="mb-3 text-sm text-muted">One item per line, as “title | detail”. Do not write passwords, keys or tokens — say where they are kept instead. Anything that looks like a secret is refused.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {SECTIONS.map(([k, label]) => <Field key={k} label={label} htmlFor={`plan-${k}`}><Textarea id={`plan-${k}`} rows={4} value={draft[k] ?? ""} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></Field>)}
                <Field label="Test the plan every (days)" htmlFor="plan-days"><Input id="plan-days" type="number" min={7} max={730} value={testEvery} onChange={(e) => setTestEvery(e.target.value)} /></Field>
                <Field label="Why is the plan changing?" htmlFor="plan-reason"><Input id="plan-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              </div>
              <Button className="mt-3" onClick={saveDraft} disabled={reason.trim().length < 5}>Save draft</Button>
            </Card>
          )}
        </>
      )}
      <SensitiveActionDialog
        open={approve !== null}
        title="Approve the recovery plan"
        description="The approved plan replaces the current one. A plan cannot be approved by the person who wrote it."
        requireReason={false}
        onCancel={() => setApprove(null)}
        onConfirm={async ({ stepUpToken }) => {
          const res = await callApi("/api/admin/soc/disaster-recovery", "POST", { action: "APPROVE", version: approve, stepUpToken });
          if (!res.ok) return res.data.error ?? "The plan was not approved.";
          show("Plan approved.", "success");
          setApprove(null);
          reload();
        }}
      />
    </div>
  );
}
