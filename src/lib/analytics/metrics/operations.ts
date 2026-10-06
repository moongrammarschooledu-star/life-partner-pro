import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL, between, countOrGroup, metric, total } from "@/lib/analytics/metrics/helpers";
import type { MetricDefinition, MetricRow } from "@/lib/analytics/types";

// STEP 31 — operations: task workload/SLA, follow-ups, verification queue. Task SLA uses the due date the workflow engine already
// assigns (AdminTask.dueAt from TaskSlaConfig); nothing here recomputes an SLA.

const CLOSED_TASK = ["COMPLETED", "CANCELLED", "EXPIRED", "ARCHIVED"] as const;
const OPEN_TASK = { status: { notIn: [...CLOSED_TASK] } };

// fixed, allow-listed column names for the few raw group-bys (never built from input)
const TASK_DIM_COLUMN: Record<string, string> = { department: "assignedDepartmentId", task_type: "taskType", priority: "priority" };

async function taskGroupCounts(where: Record<string, unknown>, dimension: string): Promise<MetricRow[]> {
  const field = TASK_DIM_COLUMN[dimension];
  return countOrGroup(prisma.adminTask as never, where, dimension, field);
}

async function durationRows(sql: Prisma.Sql): Promise<MetricRow[]> {
  const rows = await prisma.$queryRaw<Array<{ minutes: bigint | number | null; n: bigint | number }>>(sql);
  return total(Number(rows[0]?.minutes ?? 0), Number(rows[0]?.n ?? 0));
}

export const OPERATIONS_METRICS: MetricDefinition[] = [
  metric({
    key: "tasks.open", name: "Open tasks", section: "tasks", unit: "COUNT", kind: "SNAPSHOT",
    description: "Tasks that are not finished, cancelled, expired or archived.", formula: "Count of tasks whose status is not COMPLETED, CANCELLED, EXPIRED or ARCHIVED.", source: "AdminTask.status",
    dimensions: ["department", "task_type", "priority"], synonyms: ["open tasks", "pending tasks", "task backlog", "tasks"],
    v1: (_r, _c, dim) => taskGroupCounts({ ...OPEN_TASK }, dim),
  }),
  metric({
    key: "tasks.overdue", name: "Overdue tasks", section: "tasks", unit: "COUNT", kind: "SNAPSHOT",
    description: "Open tasks past their due date.", formula: "Count of open tasks whose due date is earlier than now.", source: "AdminTask.dueAt",
    dimensions: ["department", "task_type", "priority"], synonyms: ["overdue tasks", "late tasks", "sla breaches", "sla breach"],
    v1: (_r, ctx, dim) => taskGroupCounts({ ...OPEN_TASK, dueAt: { lt: ctx.now } }, dim),
  }),
  metric({
    key: "tasks.completed", name: "Tasks completed", section: "tasks", unit: "COUNT", kind: "PERIOD",
    description: "Tasks completed during the period.", formula: "Count of tasks whose completion time is in the period.", source: "AdminTask.completedAt",
    dimensions: ["department", "task_type", "priority"], synonyms: ["tasks completed", "completed tasks", "tasks done"],
    v1: (r, _c, dim) => taskGroupCounts({ completedAt: between(r) }, dim),
  }),
  metric({
    key: "tasks.sla_compliance", name: "Task SLA compliance", section: "tasks", unit: "PERCENT", kind: "PERIOD", isRate: true,
    description: "Share of tasks completed in the period that were completed on or before their due date.", formula: "Tasks completed on/before due date ÷ tasks completed that have a due date × 100.", source: "AdminTask.completedAt, dueAt",
    exclusions: ["tasks without a due date"], synonyms: ["sla compliance", "task sla", "sla performance", "sla"],
    v1: async (r) => {
      const rows = await prisma.$queryRaw<Array<{ ok: number; n: number }>>(Prisma.sql`SELECT (COUNT(*) FILTER (WHERE "completedAt" <= "dueAt"))::int AS ok, COUNT(*)::int AS n FROM "AdminTask" WHERE "completedAt" >= ${r.startUtc} AND "completedAt" < ${r.endUtc} AND "dueAt" IS NOT NULL`);
      return total(Number(rows[0]?.ok ?? 0), Number(rows[0]?.n ?? 0));
    },
  }),
  metric({
    key: "tasks.avg_first_action_hours", name: "Average time to first action", section: "tasks", unit: "HOURS", kind: "PERIOD", isDuration: true,
    description: "Average time between a task being created and work starting on it (tasks created in the period that have started).", formula: "Average of (started − created) for tasks created in the period that have a start time.", source: "AdminTask.createdAt, startedAt",
    exclusions: ["tasks not yet started"], synonyms: ["time to first action", "average first action", "response time"],
    v1: (r) => durationRows(Prisma.sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("startedAt" - "createdAt")) / 60), 0)::bigint AS minutes, COUNT(*)::int AS n FROM "AdminTask" WHERE "createdAt" >= ${r.startUtc} AND "createdAt" < ${r.endUtc} AND "startedAt" IS NOT NULL`),
  }),
  metric({
    key: "tasks.avg_completion_hours", name: "Average time to completion", section: "tasks", unit: "HOURS", kind: "PERIOD", isDuration: true,
    description: "Average time from creation to completion for tasks completed in the period.", formula: "Average of (completed − created) for tasks completed in the period.", source: "AdminTask.createdAt, completedAt",
    synonyms: ["time to completion", "average completion time", "handling time"],
    v1: (r) => durationRows(Prisma.sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("completedAt" - "createdAt")) / 60), 0)::bigint AS minutes, COUNT(*)::int AS n FROM "AdminTask" WHERE "completedAt" >= ${r.startUtc} AND "completedAt" < ${r.endUtc}`),
  }),
  metric({
    key: "followups.pending", name: "Pending follow-ups", section: "operations", unit: "COUNT", kind: "SNAPSHOT",
    description: "Follow-ups that are not completed or cancelled.", formula: "Count of follow-ups with status not COMPLETED or CANCELLED.", source: "FollowUp.status",
    synonyms: ["pending follow-ups", "follow-up workload", "followups pending", "follow ups"],
    v1: async () => total(await prisma.followUp.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } })),
  }),
  metric({
    key: "followups.overdue", name: "Overdue follow-ups", section: "operations", unit: "COUNT", kind: "SNAPSHOT",
    description: "Open follow-ups past their due date.", formula: "Count of open follow-ups whose due date is earlier than now.", source: "FollowUp.dueDate",
    synonyms: ["overdue follow-ups", "late follow-ups"],
    v1: async (_r, ctx) => total(await prisma.followUp.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: ctx.now } } })),
  }),
  metric({
    key: "followups.completed", name: "Follow-ups completed", section: "operations", unit: "COUNT", kind: "PERIOD",
    description: "Follow-ups completed during the period.", formula: "Count of follow-ups whose completion time is in the period.", source: "FollowUp.completedAt",
    synonyms: ["follow-ups completed", "completed follow-ups"],
    v1: async (r) => total(await prisma.followUp.count({ where: { completedAt: between(r) } })),
  }),
  metric({
    key: "verification.queue", name: "Verification queue", section: "verification", unit: "COUNT", kind: "SNAPSHOT",
    description: "Verification records waiting for or in review, or needing more information.", formula: "Count of verification records in VERIFICATION_PENDING, UNDER_REVIEW, VERIFICATION_REQUIRED or RE_VERIFICATION_REQUIRED.", source: "ProfileVerification.status",
    dimensions: ["status"], synonyms: ["verification queue", "pending verification", "verification backlog", "verifications pending"],
    v1: (_r, _c, dim) => countOrGroup(prisma.profileVerification as never, { status: { in: ["VERIFICATION_PENDING", "UNDER_REVIEW", "VERIFICATION_REQUIRED", "RE_VERIFICATION_REQUIRED"] } }, dim, "status"),
  }),
  metric({
    key: "verification.by_status", name: "Verification records by status", section: "verification", unit: "COUNT", kind: "SNAPSHOT",
    description: "All verification records grouped by their current status.", formula: "Count of verification records, grouped by status.", source: "ProfileVerification.status",
    dimensions: ["status"], synonyms: ["verification status", "verification statuses", "rejected verifications", "expired verifications"],
    v1: (_r, _c, dim) => countOrGroup(prisma.profileVerification as never, {}, dim, "status"),
  }),
  metric({
    key: "verification.avg_processing_hours", name: "Average verification processing time", section: "verification", unit: "HOURS", kind: "PERIOD", isDuration: true,
    description: "Average time from a verification record being created to it being verified, for records verified in the period.", formula: "Average of (updated − created) for verification records in VERIFIED state updated in the period.", source: "ProfileVerification.createdAt, updatedAt",
    synonyms: ["verification processing time", "average verification time", "time to verify"],
    v1: (r) => durationRows(Prisma.sql`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 60), 0)::bigint AS minutes, COUNT(*)::int AS n FROM "ProfileVerification" WHERE "status"::text = 'VERIFIED' AND "updatedAt" >= ${r.startUtc} AND "updatedAt" < ${r.endUtc}`),
  }),
  metric({
    key: "identity.provider_events", name: "Identity provider events received", section: "identity", unit: "COUNT", kind: "PERIOD",
    description: "Events received from the identity-verification provider (aggregate only; no documents or personal data).", formula: "Count of provider events received in the period, optionally split by event type.", source: "VerificationProviderEvent",
    dimensions: ["event_type"], requires: ["analytics:sensitive:view"], synonyms: ["provider events", "identity provider", "kyc events"],
    v1: (r, _c, dim) => countOrGroup(prisma.verificationProviderEvent as never, { createdAt: between(r) }, dim, dim === "event_type" ? "eventType" : undefined),
  }),
  metric({
    key: "identity.provider_invalid_signatures", name: "Provider events with an invalid signature", section: "identity", unit: "COUNT", kind: "PERIOD",
    description: "Provider events rejected because their signature did not verify (a provider-health signal).", formula: "Count of provider events in the period with signatureValid = false.", source: "VerificationProviderEvent.signatureValid",
    requires: ["analytics:sensitive:view"], synonyms: ["provider failures", "provider failure", "invalid signatures"],
    v1: async (r) => total(await prisma.verificationProviderEvent.count({ where: { createdAt: between(r), signatureValid: false } })),
  }),
];

export { ALL };
