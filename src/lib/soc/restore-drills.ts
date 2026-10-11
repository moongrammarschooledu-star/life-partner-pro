import type { Prisma, RestoreDrill } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { redactString } from "@/lib/observability/redact";
import { socAudit } from "@/lib/soc/audit";

// STEP 32 — restore drills. A backup that has never been restored is a hope, not a backup, so this records the evidence that one WAS:
//   1. the performer starts a drill against a chosen backup and names the ISOLATED environment it is restored into;
//   2. the app runs the automated verification (decrypt + checksum + row counts) — that part is real and recorded as such;
//   3. the performer restores into the isolated environment with scripts/restore-backup.ts and checks off eight items, each PASSED / FAILED
//      with a note — the application cannot do these for them, so they are an attestation by a named person, and are labelled that way;
//   4. a DIFFERENT person reviews and signs off.
// The application never restores into production and never writes backup data anywhere. A drill counts as PROOF only when it is PASSED,
// every item is PASSED, and a reviewer other than the performer approved it.

export const DRILL_ITEMS = [
  { key: "DATABASE_RESTORE", label: "The database restored completely into the isolated environment" },
  { key: "FILE_RESTORE", label: "Photos, documents and evidence files restored and readable" },
  { key: "RELATIONSHIPS", label: "Relationships between records are intact (profiles, proposals, payments, cases)" },
  { key: "MIGRATION_COMPATIBILITY", label: "The restored data is compatible with the current migrations" },
  { key: "APPLICATION_STARTUP", label: "The application started against the restored database" },
  { key: "AUTHENTICATION", label: "An administrator could sign in against the restored data" },
  { key: "CRITICAL_WORKFLOWS", label: "Critical workflows worked (open a profile, a proposal, a payment record)" },
  { key: "DATA_INTEGRITY", label: "The data integrity checks passed on the restored data" },
] as const;
export type DrillItemKey = (typeof DRILL_ITEMS)[number]["key"];
export type DrillItemStatus = "PASSED" | "FAILED" | "NOT_RUN";
export interface DrillItem { key: DrillItemKey; status: DrillItemStatus; note: string }

const FORBIDDEN_LABEL = /\b(prod(uction)?|live|primary|main)\b/i;

export const initialItems = (): DrillItem[] => DRILL_ITEMS.map((i) => ({ key: i.key, status: "NOT_RUN", note: "" }));

// Pure: the status a drill may be completed with, or an error.
export function completionVerdict(items: DrillItem[], verifyPassed: boolean | null): { ok: true; status: "PASSED" | "FAILED" } | { ok: false; error: string } {
  const notRun = items.filter((i) => i.status === "NOT_RUN");
  if (notRun.length) return { ok: false, error: `${notRun.length} checklist item(s) have not been run yet.` };
  const allPassed = items.every((i) => i.status === "PASSED");
  return { ok: true, status: allPassed && verifyPassed === true ? "PASSED" : "FAILED" };
}

// Pure: is this drill real proof that a restore works?
export function isProof(d: Pick<RestoreDrill, "status" | "reviewedById" | "reviewedAt" | "performedById">): boolean {
  return d.status === "PASSED" && !!d.reviewedById && !!d.reviewedAt && d.reviewedById !== d.performedById;
}

const clean = (s: string | undefined | null, n: number): string => redactString((s ?? "").trim(), n);

export async function startDrill(performerId: string, input: { backupId: string; environmentLabel: string; isolatedConfirmed: boolean }, verify: (backupId: string, actorId: string) => Promise<{ passed: boolean; checks: unknown[]; testId: string }>): Promise<RestoreDrill> {
  const label = clean(input.environmentLabel, 60);
  if (label.length < 3) throw new HttpError(422, "Name the isolated environment (at least 3 characters).");
  if (FORBIDDEN_LABEL.test(label)) throw new HttpError(422, "A restore drill must use an isolated environment. The name cannot refer to production or the live system.");
  if (input.isolatedConfirmed !== true) throw new HttpError(422, "Confirm that the restore is into an isolated environment, not production.");
  const backup = await prisma.backupRun.findUnique({ where: { id: input.backupId }, select: { id: true, backupCode: true, type: true, status: true } });
  if (!backup) throw new HttpError(404, "Backup not found.");
  if (backup.type !== "DATABASE" || backup.status !== "COMPLETED") throw new HttpError(409, "Choose a completed database backup.");
  if (await prisma.restoreDrill.findFirst({ where: { status: "IN_PROGRESS", performedById: performerId } })) throw new HttpError(409, "You already have a restore drill in progress. Finish it first.");

  const result = await verify(backup.id, performerId); // the REAL automated step: decrypt + checksum + row counts
  const drill = await prisma.restoreDrill.create({
    data: {
      backupId: backup.id, backupCode: backup.backupCode, environmentLabel: label, status: "IN_PROGRESS", items: initialItems() as unknown as Prisma.InputJsonValue, performedById: performerId,
      verifySummary: { passed: result.passed, checks: result.checks.length, isolatedConfirmed: true, automatedAt: new Date().toISOString() } as Prisma.InputJsonValue,
    },
  });
  await socAudit({ action: "SOC_RESTORE_DRILL_RECORDED", actorId: performerId, resource: "restore-drill", resourceId: drill.id, after: { backup: backup.backupCode, verifyPassed: result.passed, environment: label } });
  return drill;
}

async function loadDrill(id: string): Promise<RestoreDrill> {
  const d = await prisma.restoreDrill.findUnique({ where: { id } });
  if (!d) throw new HttpError(404, "Restore drill not found.");
  return d;
}

export async function recordItem(actorId: string, drillId: string, key: string, status: DrillItemStatus, note: string): Promise<RestoreDrill> {
  const d = await loadDrill(drillId);
  if (d.performedById !== actorId) throw new HttpError(403, "Only the person who performed the drill can record its results.");
  if (d.status !== "IN_PROGRESS") throw new HttpError(409, "This drill is already complete.");
  if (!DRILL_ITEMS.some((i) => i.key === key)) throw new HttpError(422, "Unknown checklist item.");
  if (!["PASSED", "FAILED", "NOT_RUN"].includes(status)) throw new HttpError(422, "Unknown status.");
  const text = clean(note, 400);
  if (status === "FAILED" && text.length < 10) throw new HttpError(422, "Say what failed (at least 10 characters).");
  if (status === "PASSED" && text.length < 5) throw new HttpError(422, "Say how it was checked (a few words).");
  const items = (d.items as unknown as DrillItem[]).map((i) => (i.key === key ? { ...i, status, note: text } : i));
  return prisma.restoreDrill.update({ where: { id: drillId }, data: { items: items as unknown as Prisma.InputJsonValue } });
}

export async function completeDrill(actorId: string, drillId: string, failureNote?: string, now: Date = new Date()): Promise<RestoreDrill> {
  const d = await loadDrill(drillId);
  if (d.performedById !== actorId) throw new HttpError(403, "Only the person who performed the drill can complete it.");
  if (d.status !== "IN_PROGRESS") throw new HttpError(409, "This drill is already complete.");
  const items = d.items as unknown as DrillItem[];
  const verifyPassed = (d.verifySummary as { passed?: boolean } | null)?.passed ?? null;
  const verdict = completionVerdict(items, verifyPassed);
  if (!verdict.ok) throw new HttpError(422, verdict.error);
  const note = clean(failureNote, 400);
  if (verdict.status === "FAILED" && note.length < 10) throw new HttpError(422, "The drill did not pass: summarise what failed (at least 10 characters).");
  const done = await prisma.restoreDrill.update({
    where: { id: drillId },
    data: { status: verdict.status, completedAt: now, durationSeconds: Math.max(1, Math.round((now.getTime() - d.startedAt.getTime()) / 1000)), failureNote: verdict.status === "FAILED" ? note : null },
  });
  await socAudit({ action: "SOC_RESTORE_DRILL_RECORDED", actorId, resource: "restore-drill", resourceId: drillId, after: { status: verdict.status, durationSeconds: done.durationSeconds } });
  return done;
}

export async function reviewDrill(reviewerId: string, drillId: string, decision: "APPROVE" | "REJECT", note: string): Promise<RestoreDrill> {
  const d = await loadDrill(drillId);
  if (d.performedById === reviewerId) throw new HttpError(403, "A drill cannot be reviewed by the person who performed it.");
  if (d.status === "IN_PROGRESS") throw new HttpError(409, "The drill is not complete yet.");
  if (d.reviewedAt) throw new HttpError(409, "This drill has already been reviewed.");
  const text = clean(note, 400);
  if (text.length < 5) throw new HttpError(422, "A short review note is required.");
  if (decision === "APPROVE" && d.status !== "PASSED") throw new HttpError(409, "Only a drill that passed can be approved. A failed drill is recorded as failed.");
  const reviewed = await prisma.restoreDrill.update({
    where: { id: drillId },
    data: { reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: text, ...(decision === "REJECT" ? { status: "FAILED", failureNote: d.failureNote ?? `Review rejected: ${text}`.slice(0, 400) } : {}) },
  });
  await socAudit({ action: "SOC_RESTORE_DRILL_REVIEWED", actorId: reviewerId, resource: "restore-drill", resourceId: drillId, after: { decision }, reason: note });
  return reviewed;
}

export async function listDrills(limit = 50) {
  return prisma.restoreDrill.findMany({ orderBy: { startedAt: "desc" }, take: Math.min(limit, 200) });
}

export async function getDrill(id: string) {
  return loadDrill(id);
}

export interface RestoreProof { hasProof: boolean; lastProven: { drillId: string; completedAt: Date | null; durationSeconds: number | null; backupCode: string | null; environmentLabel: string } | null; ageDays: number | null; lastAttempt: { status: string; at: Date } | null }

export async function restoreProof(now: Date = new Date()): Promise<RestoreProof> {
  const drills = await prisma.restoreDrill.findMany({ orderBy: { startedAt: "desc" }, take: 100 });
  const proven = drills.find((d) => isProof(d));
  const last = drills[0];
  return {
    hasProof: !!proven,
    lastProven: proven ? { drillId: proven.id, completedAt: proven.completedAt, durationSeconds: proven.durationSeconds, backupCode: proven.backupCode, environmentLabel: proven.environmentLabel } : null,
    ageDays: proven?.completedAt ? Math.floor((now.getTime() - proven.completedAt.getTime()) / 86_400_000) : null,
    lastAttempt: last ? { status: last.status, at: last.startedAt } : null,
  };
}
