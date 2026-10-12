import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError as ApiError } from "@/lib/http-error";
import { getServerConfig } from "@/lib/config/server-config";
import { getReadinessReport } from "@/lib/ops/readiness";
import { decide, autoBlockReason, liveDrift, isGoLiveStatus, type GoLiveAction, type GoLiveStatus, type GateFacts } from "@/lib/ops/go-live-rules";

// STEP 34 §45 — the go-live approval gate (service). The rules live in go-live-rules.ts; this file only reads the proof, applies the decision
// with a compare-and-set (two administrators clicking at once cannot both win) and writes the history + audit trail.
// It is a governance record: it does not open or close traffic and it does not switch any feature on.

const STATE_ID = "singleton";

const AUDIT = { MARK_READY: "GO_LIVE_MARKED_READY", APPROVE: "GO_LIVE_APPROVED", GO_LIVE: "GO_LIVE_RECORDED_LIVE", BLOCK: "GO_LIVE_BLOCKED" } as const;

async function loadFacts(): Promise<GateFacts & { gates: Array<{ id: string; title: string; status: string; required: boolean }> }> {
  const report = await getReadinessReport();
  return {
    verdict: report.verdict,
    unresolved: report.unresolved,
    currentCommit: getServerConfig().commitSha,
    gates: report.gates.map((g) => ({ id: g.id, title: g.title, status: g.status, required: g.required })),
  };
}

async function ensureState() {
  // A deployment that already exists in production starts BLOCKED: nobody has approved it through this gate yet.
  return prisma.goLiveState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, status: "GO_LIVE_BLOCKED" }, update: {} });
}

function snapshot(row: { status: string; readyById: string | null; commitSha: string | null }) {
  if (!isGoLiveStatus(row.status)) throw new ApiError(500, "The go-live record holds an unknown status.");
  return { status: row.status as GoLiveStatus, readyById: row.readyById, commitSha: row.commitSha };
}

async function transition(args: { from: GoLiveStatus; to: GoLiveStatus; action: GoLiveAction | "AUTO_BLOCK"; actorId: string | null; reason: string | null; facts: GateFacts; data: Record<string, unknown> }) {
  const gateSummary = { verdict: args.facts.verdict, unresolved: args.facts.unresolved.slice(0, 25) };
  const claimed = await prisma.$transaction(async (tx) => {
    const res = await tx.goLiveState.updateMany({ where: { id: STATE_ID, status: args.from }, data: { status: args.to, reason: args.reason, ...args.data } });
    if (res.count !== 1) return false;
    await tx.goLiveEvent.create({ data: { fromStatus: args.from, toStatus: args.to, action: args.action, actorId: args.actorId, reason: args.reason, commitSha: args.facts.currentCommit, gateSummary } });
    return true;
  });
  if (!claimed) throw new ApiError(409, "The go-live status changed while you were working. Reload and look again.");
  const audit = args.action === "AUTO_BLOCK" ? "GO_LIVE_BLOCKED" : AUDIT[args.action];
  await writeAudit({ action: audit, adminId: args.actorId, meta: { from: args.from, to: args.to, reason: args.reason, commitSha: args.facts.currentCommit, automatic: args.action === "AUTO_BLOCK", verdict: args.facts.verdict } });
}

/** Reads the state and, if READY/APPROVED no longer holds, drops it to BLOCKED (and says why). */
export async function reconcileGoLive() {
  let row = await ensureState();
  const facts = await loadFacts();
  const why = autoBlockReason(snapshot(row), facts);
  if (why) {
    await transition({
      from: snapshot(row).status, to: "GO_LIVE_BLOCKED", action: "AUTO_BLOCK", actorId: null, reason: why, facts,
      data: { readyById: null, readyAt: null, approvedById: null, approvedAt: null, liveById: null, liveAt: null, commitSha: null },
    }).catch((e) => { if (!(e instanceof ApiError && e.status === 409)) throw e; });
    row = await ensureState();
  }
  return { row, facts, drift: liveDrift(snapshot(row), facts) };
}

export async function getGoLiveView() {
  const { row, facts, drift } = await reconcileGoLive();
  const events = await prisma.goLiveEvent.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const ids = [...new Set([row.readyById, row.approvedById, row.liveById, ...events.map((e) => e.actorId)].filter((v): v is string => !!v))];
  const admins = ids.length ? await prisma.adminUser.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameOf = (id: string | null) => (id ? admins.find((a) => a.id === id)?.name ?? "Administrator" : null);
  return {
    status: row.status as GoLiveStatus,
    commitSha: row.commitSha,
    readyBy: nameOf(row.readyById), readyAt: row.readyAt,
    approvedBy: nameOf(row.approvedById), approvedAt: row.approvedAt,
    liveBy: nameOf(row.liveById), liveAt: row.liveAt,
    reason: row.reason,
    verdict: facts.verdict,
    unresolved: facts.unresolved,
    currentCommit: facts.currentCommit,
    drift,
    events: events.map((e) => ({ id: e.id, at: e.createdAt, from: e.fromStatus, to: e.toStatus, action: e.action, by: e.actorId ? nameOf(e.actorId) : "System", reason: e.reason, commitSha: e.commitSha })),
  };
}

export async function actOnGoLive(args: { action: GoLiveAction; actorId: string; reason?: string | null }) {
  const { row, facts } = await reconcileGoLive();
  const state = snapshot(row);
  const reason = args.reason?.trim() ? args.reason.trim().slice(0, 500) : null;
  const d = decide({ action: args.action, state, actorId: args.actorId, facts, reason });
  if (!d.ok) throw new ApiError(d.code === "WRONG_STATE" ? 409 : 400, d.message);

  const now = new Date();
  const data: Record<string, unknown> =
    args.action === "MARK_READY" ? { readyById: args.actorId, readyAt: now, approvedById: null, approvedAt: null, liveById: null, liveAt: null, commitSha: facts.currentCommit }
    : args.action === "APPROVE" ? { approvedById: args.actorId, approvedAt: now }
    : args.action === "GO_LIVE" ? { liveById: args.actorId, liveAt: now }
    : { readyById: null, readyAt: null, approvedById: null, approvedAt: null, liveById: null, liveAt: null, commitSha: null };
  await transition({ from: state.status, to: d.to, action: args.action, actorId: args.actorId, reason, facts, data });
  return getGoLiveView();
}
