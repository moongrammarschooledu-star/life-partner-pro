"use client";

import { useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/form";
import { Card, ErrorNote, Loading, useApi } from "@/components/admin/system/shared";
import { formatEnumLabel } from "@/lib/utils";

interface Graph {
  rootProfileId: string;
  nodes: Array<{ profileId: string; profileCode: string; status: string; depth: number }>;
  edges: Array<{ a: string; b: string; type: string; band: string | null }>;
  truncated: boolean;
}

const EDGE_COLOR: Record<string, string> = {
  CONFIRMED_DUPLICATE: "#dc2626",
  LIKELY_DUPLICATE: "#ea580c",
  POTENTIAL_DUPLICATE: "#d97706",
  AUTHORIZED_FAMILY_ACCOUNT: "#16a34a",
  FAMILY_RELATED: "#16a34a",
  UNKNOWN_RELATIONSHIP: "#6b7280",
};

// Admin-only relationship view. Nodes are profile codes and lifecycle status only; no name, contact detail, photo or
// sensitive trait appears here. Layout is a simple deterministic ring so nothing depends on a chart library.
export function RiskGraphClient({ profileId }: { profileId: string }) {
  const [depth, setDepth] = useState("1");
  const { data, error, loading } = useApi<Graph>(`/api/admin/risk/accounts/${profileId}/relationships?depth=${depth}`);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  const size = 420;
  const center = size / 2;
  const others = data.nodes.filter((n) => n.profileId !== data.rootProfileId);
  const pos = new Map<string, { x: number; y: number }>([[data.rootProfileId, { x: center, y: center }]]);
  others.forEach((n, i) => {
    const ring = n.depth <= 1 ? 140 : 190;
    const angle = (2 * Math.PI * i) / Math.max(others.length, 1);
    pos.set(n.profileId, { x: center + ring * Math.cos(angle), y: center + ring * Math.sin(angle) });
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/risk-center" className="text-sm text-primary hover:underline">← Risk &amp; Safety Center</Link>
          <h1 className="text-xl font-semibold">Account relationships</h1>
          <p className="text-sm text-muted">Admin-only. Relationships are review aids, not conclusions — related accounts are often family.</p>
        </div>
        <Select value={depth} onChange={(e) => setDepth(e.target.value)} className="w-40"><option value="1">Direct links</option><option value="2">Two steps</option></Select>
      </div>
      {data.nodes.length <= 1 ? (
        <Card><p className="text-sm text-muted">No recorded relationships for this account.</p></Card>
      ) : (
        <Card>
          <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-lg" role="img" aria-label="Account relationship graph">
            {data.edges.map((e, i) => {
              const a = pos.get(e.a);
              const b = pos.get(e.b);
              if (!a || !b) return null;
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE_COLOR[e.type] ?? "#6b7280"} strokeWidth={2} />;
            })}
            {data.nodes.map((n) => {
              const p = pos.get(n.profileId);
              if (!p) return null;
              const root = n.profileId === data.rootProfileId;
              return (
                <g key={n.profileId}>
                  <circle cx={p.x} cy={p.y} r={root ? 22 : 16} fill={root ? "#2563eb" : "#e5e7eb"} stroke="#9ca3af" />
                  <text x={p.x} y={p.y + (root ? 38 : 32)} textAnchor="middle" fontSize="10" fill="currentColor">{n.profileCode}</text>
                </g>
              );
            })}
          </svg>
          {data.truncated && <p className="mt-2 text-center text-xs text-muted">Showing the first {data.nodes.length} accounts.</p>}
        </Card>
      )}
      <Card title="Legend">
        <ul className="space-y-1 text-sm">
          {data.edges.map((e, i) => <li key={i} className="flex items-center gap-2"><span className="inline-block h-1 w-6" style={{ background: EDGE_COLOR[e.type] ?? "#6b7280" }} />{formatEnumLabel(e.type)}{e.band ? ` (${formatEnumLabel(e.band)})` : ""}</li>)}
          {data.edges.length === 0 && <li className="text-muted">No links.</li>}
        </ul>
      </Card>
    </div>
  );
}
