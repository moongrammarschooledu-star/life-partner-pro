import { prisma } from "@/lib/prisma";
import type { Observation, Point, RuleDefinition } from "@/lib/soc/types";

// STEP 32 — the READ half of detection. Each rule asks for one of three closed shapes (security events, denied AI requests, failed backups);
// this module turns the rows into per-subject observations. It selects identifiers and timestamps only — never request payloads — and reads
// at most MAX_ROWS per rule per run, so a flood cannot make detection itself expensive. If the cap is hit the run reports it ("truncated"),
// because a count taken from a capped read may be an under-count and the screen must say so.

export const MAX_ROWS = 20_000;

export interface Collected {
  observations: Observation[];
  truncated: boolean;
}

type Group = "adminId" | "ipHash" | "subjectKey" | "profileId";
const LABEL: Record<Group, string> = { adminId: "ADMIN", ipHash: "NETWORK", subjectKey: "ACCOUNT", profileId: "PROFILE" };

function providerOf(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const p = (JSON.parse(meta) as { provider?: unknown }).provider;
    return typeof p === "string" && /^[\w.:-]{1,40}$/.test(p) ? p : null;
  } catch {
    return null;
  }
}

export async function collectObservations(def: RuleDefinition, from: Date, to: Date): Promise<Collected> {
  const q = def.query;
  if (q.kind === "events") {
    const rows = await prisma.securityEvent.findMany({
      where: { eventType: { in: q.types }, createdAt: { gte: from, lte: to }, ...(q.outcomes ? { outcome: { in: q.outcomes } } : {}) },
      select: { id: true, adminId: true, profileId: true, ipHash: true, subjectKey: true, outcome: true, meta: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_ROWS + 1,
    });
    const truncated = rows.length > MAX_ROWS;
    const groups = new Map<string, Observation>();
    for (const r of rows.slice(0, MAX_ROWS)) {
      const g = r[q.groupBy as Group];
      if (!g) continue;
      const provider = q.providerFromMeta ? providerOf(r.meta) : null;
      const subject = provider ? `provider:${provider}` : `${q.groupBy}:${g}`;
      const resource = provider ? `WEBHOOK:${provider}` : `${LABEL[q.groupBy as Group]}:${g}`;
      let obs = groups.get(subject);
      if (!obs) groups.set(subject, (obs = { subject, resource, points: [] }));
      const point: Point = { t: r.createdAt.getTime(), ref: r.id };
      if (q.distinctBy) {
        const k = r[q.distinctBy as Group];
        if (!k) continue; // a distinct rule counts only events that carry the distinguishing key
        point.key = k;
      }
      obs.points.push(point);
    }
    return { observations: [...groups.values()], truncated };
  }

  if (q.kind === "aiDenied") {
    const rows = await prisma.aiRequest.findMany({
      where: { status: "DENIED", createdAt: { gte: from, lte: to } },
      select: { id: true, actorAdminId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_ROWS + 1,
    });
    const groups = new Map<string, Observation>();
    for (const r of rows.slice(0, MAX_ROWS)) {
      const subject = `adminId:${r.actorAdminId}`;
      let obs = groups.get(subject);
      if (!obs) groups.set(subject, (obs = { subject, resource: `ADMIN:${r.actorAdminId}`, points: [] }));
      obs.points.push({ t: r.createdAt.getTime(), ref: r.id });
    }
    return { observations: [...groups.values()], truncated: rows.length > MAX_ROWS };
  }

  // backupFailed: one subject for the whole system
  const rows = await prisma.backupRun.findMany({
    where: { status: "FAILED", startedAt: { gte: from, lte: to } },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: "asc" },
    take: 1000,
  });
  if (!rows.length) return { observations: [], truncated: false };
  return { observations: [{ subject: "system:backup", resource: "SYSTEM:backup", points: rows.map((r) => ({ t: r.startedAt.getTime(), ref: r.id })) }], truncated: false };
}
