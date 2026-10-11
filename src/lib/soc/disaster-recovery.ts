import type { DisasterRecoveryPlan, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { redactString } from "@/lib/observability/redact";
import { getSystemControl } from "@/lib/ops/system-control";
import { restoreProof } from "@/lib/soc/restore-drills";
import { socAudit } from "@/lib/soc/audit";

// STEP 32 — disaster recovery. Two things are kept strictly apart:
//   CONFIGURED objectives (RTO / RPO) — what the owner has decided to aim for, stored in System Control. Targets, never promises;
//   MEASURED results — what the data actually shows: RPO is the age of the newest backup that PASSED verification; RTO is how long the
//   latest APPROVED restore drill took. Until there is evidence, the measured side says "Not measured yet" — it is never filled in with a
//   guess or copied from the target.
// The recovery plan itself is versioned text (procedures, dependencies, contacts…), approved by someone other than its author.

export const PLAN_SECTIONS = ["procedures", "infrastructure", "providers", "contacts", "failover", "rollback", "businessContinuity"] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];
export interface PlanEntry { title: string; detail: string }
export type PlanSections = Record<PlanSection, PlanEntry[]>;

const SECRET_ASSIGNMENT = /\b(pass(word|wd)?|secret|token|api[_-]?key|private[_ -]?key|credential)s?\s*[:=]/i;
const LOOKS_LIKE_SECRET = /[A-Za-z0-9+/_-]{32,}={0,2}/;
const MAX_ENTRIES = 30;

export const emptySections = (): PlanSections => Object.fromEntries(PLAN_SECTIONS.map((s) => [s, []])) as unknown as PlanSections;

// Pure. A plan may name people, roles, providers and steps — never a credential: anything that looks like one is refused, and the author is
// told to point to where the secret is kept (the password manager, the provider console) instead of writing it here.
export function validatePlanSections(raw: unknown): { ok: true; sections: PlanSections } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "The plan sections are missing." };
  const input = raw as Record<string, unknown>;
  const out = emptySections();
  for (const key of Object.keys(input)) if (!(PLAN_SECTIONS as readonly string[]).includes(key)) return { ok: false, error: `Unknown plan section: ${key}.` };
  for (const section of PLAN_SECTIONS) {
    const list = input[section] ?? [];
    if (!Array.isArray(list)) return { ok: false, error: `${section} must be a list.` };
    if (list.length > MAX_ENTRIES) return { ok: false, error: `${section} can hold at most ${MAX_ENTRIES} entries.` };
    for (const e of list) {
      const entry = e as Partial<PlanEntry>;
      const title = typeof entry?.title === "string" ? entry.title.trim() : "";
      const detail = typeof entry?.detail === "string" ? entry.detail.trim() : "";
      if (title.length < 3 || title.length > 120) return { ok: false, error: `Each ${section} entry needs a title of 3-120 characters.` };
      if (detail.length > 800) return { ok: false, error: `Each ${section} detail can be at most 800 characters.` };
      if (SECRET_ASSIGNMENT.test(`${title} ${detail}`) || LOOKS_LIKE_SECRET.test(`${title} ${detail}`)) {
        return { ok: false, error: `An entry in ${section} looks like it contains a secret. Name where it is kept (for example the password manager) instead of writing it in the plan.` };
      }
      out[section].push({ title, detail });
    }
  }
  return { ok: true, sections: out };
}

export type Comparison = "MET" | "EXCEEDED" | "NOT_MEASURED";
// Pure. A target is MET when the measured figure is at or under it; with no measurement it is NOT_MEASURED — never assumed met.
export function compare(targetMinutes: number, measuredMinutes: number | null): Comparison {
  if (measuredMinutes === null) return "NOT_MEASURED";
  return measuredMinutes <= targetMinutes ? "MET" : "EXCEEDED";
}

export async function activePlan(): Promise<DisasterRecoveryPlan | null> {
  return prisma.disasterRecoveryPlan.findFirst({ where: { status: "ACTIVE" }, orderBy: { version: "desc" } });
}

export async function listPlans(limit = 30) {
  return prisma.disasterRecoveryPlan.findMany({ orderBy: { version: "desc" }, take: Math.min(limit, 100) });
}

export async function createPlanDraft(actorId: string, input: { sections: unknown; testEveryDays?: number | null; reason: string }): Promise<DisasterRecoveryPlan> {
  const v = validatePlanSections(input.sections);
  if (!v.ok) throw new HttpError(422, v.error);
  const reason = redactString((input.reason ?? "").trim(), 300);
  if (reason.length < 5) throw new HttpError(422, "Say why the plan is changing (at least 5 characters).");
  const days = input.testEveryDays ?? null;
  if (days !== null && (!Number.isInteger(days) || days < 7 || days > 730)) throw new HttpError(422, "The test schedule must be a whole number of days from 7 to 730.");
  if (await prisma.disasterRecoveryPlan.findFirst({ where: { status: "DRAFT" } })) throw new HttpError(409, "A draft is already waiting for approval.");
  const last = await prisma.disasterRecoveryPlan.findFirst({ orderBy: { version: "desc" } });
  const plan = await prisma.disasterRecoveryPlan.create({ data: { version: (last?.version ?? 0) + 1, status: "DRAFT", sections: v.sections as unknown as Prisma.InputJsonValue, testEveryDays: days, changeReason: reason, authorId: actorId } });
  await socAudit({ action: "SOC_DR_PLAN_CHANGED", actorId, resource: "dr-plan", resourceId: String(plan.version), after: { status: "DRAFT" }, reason });
  return plan;
}

export async function approvePlan(actorId: string, version: number): Promise<DisasterRecoveryPlan> {
  const plan = await prisma.disasterRecoveryPlan.findUnique({ where: { version } });
  if (!plan) throw new HttpError(404, "Plan version not found.");
  if (plan.status !== "DRAFT") throw new HttpError(409, "Only a draft can be approved.");
  if (plan.authorId === actorId) throw new HttpError(403, "A plan cannot be approved by the person who wrote it.");
  await prisma.disasterRecoveryPlan.updateMany({ where: { status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
  const approved = await prisma.disasterRecoveryPlan.update({ where: { version }, data: { status: "ACTIVE", approvedById: actorId, approvedAt: new Date() } });
  await socAudit({ action: "SOC_DR_PLAN_CHANGED", actorId, resource: "dr-plan", resourceId: String(version), after: { status: "ACTIVE" } });
  return approved;
}

export type DrTestType = "TABLETOP" | "RESTORE" | "FAILOVER";

export async function recordTest(actorId: string, input: { testType: DrTestType; status: "COMPLETED" | "FAILED"; performedAt: Date; durationMinutes?: number | null; findings: string; drillId?: string | null }) {
  if (!["TABLETOP", "RESTORE", "FAILOVER"].includes(input.testType)) throw new HttpError(422, "Unknown test type.");
  if (!["COMPLETED", "FAILED"].includes(input.status)) throw new HttpError(422, "Unknown status.");
  if (input.performedAt.getTime() > Date.now() + 5 * 60_000) throw new HttpError(422, "A test cannot be dated in the future.");
  const findings = redactString((input.findings ?? "").trim(), 1500);
  if (findings.length < 10) throw new HttpError(422, "Record what was tested and what was found (at least 10 characters).");
  if (input.durationMinutes != null && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 14 * 24 * 60)) throw new HttpError(422, "Duration must be a whole number of minutes.");
  if (input.drillId) {
    const d = await prisma.restoreDrill.findUnique({ where: { id: input.drillId }, select: { id: true } });
    if (!d) throw new HttpError(422, "That restore drill does not exist.");
  }
  const plan = await activePlan();
  const row = await prisma.disasterRecoveryTest.create({ data: { planVersion: plan?.version ?? null, testType: input.testType, status: input.status, performedAt: input.performedAt, durationMinutes: input.durationMinutes ?? null, findings, drillId: input.drillId ?? null, recordedById: actorId } });
  await socAudit({ action: "SOC_DR_TEST_RECORDED", actorId, resource: "dr-test", resourceId: row.id, after: { type: input.testType, status: input.status } });
  return row;
}

export async function drOverview(now: Date = new Date()) {
  const [control, plan, proof, lastBackup, tests] = await Promise.all([
    getSystemControl(),
    activePlan(),
    restoreProof(now),
    prisma.backupRun.findFirst({ where: { type: "DATABASE", status: "COMPLETED", verificationStatus: "PASSED" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, backupCode: true } }),
    prisma.disasterRecoveryTest.findMany({ where: { status: { in: ["COMPLETED", "FAILED"] } }, orderBy: { performedAt: "desc" }, take: 20 }),
  ]);
  const measuredRpo = lastBackup ? Math.max(0, Math.round((now.getTime() - lastBackup.startedAt.getTime()) / 60_000)) : null;
  const measuredRto = proof.lastProven?.durationSeconds ? Math.ceil(proof.lastProven.durationSeconds / 60) : null;
  const lastTest = tests[0] ?? null;
  const every = plan?.testEveryDays ?? null;
  const nextDueAt = every && lastTest?.performedAt ? new Date(lastTest.performedAt.getTime() + every * 86_400_000) : null;
  const sections = (plan?.sections ?? null) as unknown as PlanSections | null;
  return {
    configured: { rtoMinutes: control.rtoMinutes, rpoMinutes: control.rpoMinutes, note: "Targets set in System Control. They are objectives, not guarantees." },
    measured: {
      rpoMinutes: measuredRpo,
      rpoBasis: lastBackup ? `Age of the newest backup that passed verification (${lastBackup.backupCode})` : "No backup has passed verification yet",
      rtoMinutes: measuredRto,
      rtoBasis: proof.lastProven ? `Duration of the latest approved restore drill (${proof.lastProven.environmentLabel})` : "No restore drill has been approved yet",
      note: "Measured from real records. Shown as 'Not measured yet' until there is evidence.",
    },
    comparison: { rpo: compare(control.rpoMinutes, measuredRpo), rto: compare(control.rtoMinutes, measuredRto) },
    restoreProof: proof,
    plan: plan ? { version: plan.version, approvedAt: plan.approvedAt, testEveryDays: plan.testEveryDays, counts: sections ? Object.fromEntries(PLAN_SECTIONS.map((s) => [s, sections[s]?.length ?? 0])) : {}, infrastructure: sections?.infrastructure ?? [], providers: sections?.providers ?? [] } : null,
    tests: { everyDays: every, lastTestAt: lastTest?.performedAt ?? null, nextDueAt, overdue: nextDueAt ? nextDueAt.getTime() < now.getTime() : every ? true : false, recent: tests.slice(0, 10) },
  };
}
