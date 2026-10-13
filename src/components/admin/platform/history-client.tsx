"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { ApprovalNote, ChangeDialog, CcHeader, Table, fmt, sendChange } from "@/components/admin/platform/cc-shared";

interface Change { id: string; kind: string; key: string; version: number; actorId: string | null; actorName?: string | null; reason: string | null; environment: string; createdAt: string; rolledBackFromId: string | null; approvalId: string | null; viaBreakGlass?: boolean }
interface List { items: Change[]; nextCursor: string | null }
interface DiffEntry { path: string; before: unknown; after: unknown }
interface Detail { change: Change & { before: unknown; after: unknown }; diff: DiffEntry[] }

const KINDS = ["", "SETTING", "FEATURE_FLAG", "SYSTEM_CONTROL", "MAINTENANCE", "CHANGE_FREEZE", "ANNOUNCEMENT", "PROVIDER"];
const show_ = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

export function HistoryClient({ permissions, environment }: { permissions: string[]; environment: string }) {
  const [kind, setKind] = useState("");
  const [after, setAfter] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rollback, setRollback] = useState<Change | null>(null);
  const [approval, setApproval] = useState<string | null>(null);
  const { show } = useToast();
  const qs = new URLSearchParams();
  if (kind) qs.set("kind", kind);
  if (after) qs.set("after", after);
  const list = useApi<List>(`/api/admin/platform/configuration?${qs.toString()}`);
  const detail = useApi<Detail>(selected ? `/api/admin/platform/configuration/${selected}` : null);
  const canRollback = permissions.includes("platform:configuration:rollback");
  const rollbackable = (c: Change) => canRollback && (c.kind === "SETTING" || c.kind === "FEATURE_FLAG");

  return (
    <div className="space-y-4">
      <CcHeader title="Configuration history" description="Every platform configuration change: what changed, who changed it, why, in which environment, and the before and after (secrets are never stored). Entries cannot be edited or deleted; a rollback is a new entry." permissions={permissions} environment={environment} />
      {approval && <ApprovalNote code={approval} onClose={() => setApproval(null)} />}
      <Card title="Changes" action={<Select aria-label="Filter by kind" className="h-8 w-48" value={kind} onChange={(e) => { setKind(e.target.value); setAfter(null); }}>{KINDS.map((k) => <option key={k} value={k}>{k ? k.replace(/_/g, " ").toLowerCase() : "All kinds"}</option>)}</Select>}>
        {list.loading && <Loading />}
        {list.error && <ErrorNote message={list.error} />}
        {list.data && (
          <>
            <Table head={["Item", "Version", "By", "Why", "When", ""]} empty={list.data.items.length === 0 ? "No changes recorded yet." : undefined}>
              {list.data.items.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-2 py-2"><span className="font-mono text-xs">{c.key}</span><p className="text-xs text-muted">{c.kind.replace(/_/g, " ").toLowerCase()} · {c.environment.toLowerCase()}{c.rolledBackFromId ? " · rollback" : ""}</p></td>
                  <td className="px-2 py-2 text-muted">v{c.version}</td>
                  <td className="px-2 py-2 text-muted">{c.actorName ?? c.actorId ?? "system"}</td>
                  <td className="px-2 py-2 text-muted">{c.reason ?? "—"}</td>
                  <td className="px-2 py-2 text-muted">{fmt(c.createdAt)}</td>
                  <td className="space-x-1 whitespace-nowrap px-2 py-2 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(selected === c.id ? null : c.id)}>{selected === c.id ? "Hide" : "Compare"}</Button>{rollbackable(c) && <Button size="sm" variant="ghost" onClick={() => setRollback(c)}>Roll back</Button>}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex gap-2">
              {after && <Button size="sm" variant="outline" onClick={() => setAfter(null)}>Newest</Button>}
              {list.data.nextCursor && <Button size="sm" variant="outline" onClick={() => setAfter(list.data!.nextCursor)}>Older changes</Button>}
            </div>
          </>
        )}
      </Card>
      {selected && (
        <Card title="Before and after">
          {detail.loading && <Loading />}
          {detail.error && <ErrorNote message={detail.error} />}
          {detail.data && (
            detail.data.diff.length === 0 ? <p className="text-sm text-muted">No difference was recorded for this entry.</p> : (
              <Table head={["Field", "Before", "After"]}>{detail.data.diff.map((d) => <tr key={d.path} className="align-top"><td className="px-2 py-2 font-mono text-xs">{d.path}</td><td className="px-2 py-2 text-muted">{show_(d.before)}</td><td className="px-2 py-2">{show_(d.after)}</td></tr>)}</Table>
            )
          )}
          <p className="mt-2 text-xs text-muted"><Badge variant="muted">note</Badge> Values that look like secrets were replaced before they were stored.</p>
        </Card>
      )}
      <ChangeDialog
        open={rollback !== null}
        danger
        title={rollback ? `Roll back ${rollback.key}` : "Roll back"}
        description="The previous value is applied again as a NEW entry. It is refused if the item has changed since, and some rollbacks need a second administrator's approval."
        environment={environment}
        onCancel={() => setRollback(null)}
        submit={async ({ reason, stepUpToken, environment: env }) => {
          if (!rollback) return null;
          const res = await sendChange(`/api/admin/platform/configuration/${rollback.id}/rollback`, "POST", { reason, environment: env, stepUpToken });
          if (res.error) return res.error;
          if (res.approvalCode) setApproval(res.approvalCode); else show("Rolled back.", "success");
          setRollback(null);
          list.reload();
          return null;
        }}
      />
    </div>
  );
}
