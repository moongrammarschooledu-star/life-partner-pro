import { prisma } from "@/lib/prisma";

// Communication analytics (spec §56). AGGREGATES ONLY: counts, rates and durations grouped by channel / provider / template / type.
// No profile identifier, address or content ever appears, and nothing here infers a personal characteristic from engagement.
// Honesty rules: "delivered" and "read" are counted only where a provider actually reported them (never assumed), and traffic that
// went to the SANDBOX provider is reported separately - it was never delivered to a real recipient.

export interface CommunicationAnalytics {
  period: { from: string; to: string };
  totals: { messages: number; sent: number; delivered: number; read: number; failed: number; bounced: number; rejected: number; cancelledOrBlocked: number; queued: number; deadLettered: number; sandboxOnly: number };
  rates: { deliveryRateOfReported: number | null; failureRate: number | null; bounceRate: number | null; readRateOfDelivered: number | null };
  latency: { avgSecondsToSent: number | null; p95SecondsToSent: number | null; samples: number };
  byChannel: Record<string, { sent: number; delivered: number; failed: number }>;
  byProvider: Record<string, { sent: number; delivered: number; failed: number }>;
  byMessageType: Record<string, number>;
  byTemplate: Array<{ templateId: string; version: number | null; messages: number; failed: number }>;
  suppressions: { added: number; active: number };
  followUps: { created: number; completed: number; completionRate: number | null };
  threads: { open: number; withUserReply: number; replyRate: number | null };
  blockedByReason: Record<string, number>;
  generatedAt: string;
}

const OK: string[] = ["SENT", "DELIVERED", "READ"];

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const ratio = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

export async function computeCommunicationAnalytics(range: { from: Date; to: Date }): Promise<CommunicationAnalytics> {
  const created = { gte: range.from, lte: range.to };
  const [logs, suppressionsAdded, suppressionsActive, followEvents, threadsOpen] = await Promise.all([
    prisma.communicationLog.findMany({
      where: { createdAt: created, isTest: false, channel: { not: "IN_APP" } },
      select: { channel: true, provider: true, deliveryStatus: true, messageType: true, templateId: true, templateVersion: true, queuedAt: true, sentAt: true, deadLetteredAt: true, blockedReason: true },
      take: 20000,
    }),
    prisma.communicationSuppression.count({ where: { createdAt: created } }),
    prisma.communicationSuppression.count({ where: { status: "ACTIVE" } }),
    prisma.workflowEvent.findMany({ where: { eventName: { startsWith: "FOLLOWUP_AUTOMATION_" }, createdAt: created }, select: { taskId: true }, take: 5000 }),
    prisma.communicationThread.findMany({ where: { createdAt: created, type: { in: ["SUPPORT_THREAD", "PROPOSAL_COORDINATION", "MEETING_COORDINATION", "VERIFICATION_THREAD"] } }, select: { id: true, status: true }, take: 5000 }),
  ]);

  const isSandbox = (p: string | null) => !!p && p.startsWith("sandbox");
  const real = logs.filter((l) => !isSandbox(l.provider) && !l.blockedReason);
  const count = (s: string[]) => real.filter((l) => s.includes(l.deliveryStatus)).length;
  const sent = count(["SENT"]);
  const delivered = count(["DELIVERED"]);
  const read = count(["READ"]);
  const failed = count(["FAILED", "EXPIRED"]);
  const bounced = count(["BOUNCED"]);
  const rejected = count(["REJECTED"]);

  const group = (rows: typeof real, key: (l: (typeof real)[number]) => string) => {
    const out: Record<string, { sent: number; delivered: number; failed: number }> = {};
    for (const l of rows) {
      const k = key(l);
      const e = (out[k] ??= { sent: 0, delivered: 0, failed: 0 });
      if (OK.includes(l.deliveryStatus)) e.sent++;
      if (l.deliveryStatus === "DELIVERED" || l.deliveryStatus === "READ") e.delivered++;
      if (["FAILED", "BOUNCED", "REJECTED", "EXPIRED"].includes(l.deliveryStatus)) e.failed++;
    }
    return out;
  };

  const latencies = real.filter((l) => l.queuedAt && l.sentAt).map((l) => ((l.sentAt as Date).getTime() - (l.queuedAt as Date).getTime()) / 1000);
  const templates = new Map<string, { templateId: string; version: number | null; messages: number; failed: number }>();
  for (const l of real) {
    if (!l.templateId) continue;
    const k = `${l.templateId}:${l.templateVersion ?? ""}`;
    const e = templates.get(k) ?? { templateId: l.templateId, version: l.templateVersion, messages: 0, failed: 0 };
    e.messages++;
    if (["FAILED", "BOUNCED", "REJECTED", "EXPIRED"].includes(l.deliveryStatus)) e.failed++;
    templates.set(k, e);
  }
  const blockedByReason: Record<string, number> = {};
  for (const l of logs) if (l.blockedReason) blockedByReason[l.blockedReason] = (blockedByReason[l.blockedReason] ?? 0) + 1;
  const byMessageType: Record<string, number> = {};
  for (const l of logs) if (l.messageType) byMessageType[l.messageType] = (byMessageType[l.messageType] ?? 0) + 1;

  const taskIds = followEvents.map((e) => e.taskId).filter((x): x is string => !!x);
  const completedTasks = taskIds.length ? await prisma.adminTask.count({ where: { id: { in: taskIds }, status: "COMPLETED" } }) : 0;

  const threadIds = threadsOpen.map((t) => t.id);
  const replied = threadIds.length ? (await prisma.communicationThreadMessage.findMany({ where: { threadId: { in: threadIds }, authorType: "PROFILE" }, distinct: ["threadId"], select: { threadId: true } })).length : 0;

  return {
    period: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals: {
      messages: logs.length,
      sent: sent + delivered + read,
      delivered: delivered + read,
      read,
      failed,
      bounced,
      rejected,
      cancelledOrBlocked: logs.filter((l) => l.deliveryStatus === "CANCELLED").length,
      queued: logs.filter((l) => ["QUEUED", "SENDING"].includes(l.deliveryStatus)).length,
      deadLettered: logs.filter((l) => l.deadLetteredAt).length,
      sandboxOnly: logs.filter((l) => isSandbox(l.provider)).length,
    },
    rates: {
      // Only over messages whose provider can report delivery; SMTP e-mail with no webhook stays SENT, so it is not in the denominator.
      deliveryRateOfReported: ratio(delivered + read, delivered + read + failed + bounced + rejected),
      failureRate: ratio(failed + rejected, real.length),
      bounceRate: ratio(bounced, real.length),
      readRateOfDelivered: ratio(read, delivered + read),
    },
    latency: { avgSecondsToSent: latencies.length ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : null, p95SecondsToSent: percentile(latencies, 95), samples: latencies.length },
    byChannel: group(real, (l) => l.channel),
    byProvider: group(real, (l) => l.provider ?? "unknown"),
    byMessageType,
    byTemplate: [...templates.values()].sort((a, b) => b.messages - a.messages).slice(0, 25),
    suppressions: { added: suppressionsAdded, active: suppressionsActive },
    followUps: { created: taskIds.length, completed: completedTasks, completionRate: ratio(completedTasks, taskIds.length) },
    threads: { open: threadsOpen.filter((t) => t.status === "OPEN").length, withUserReply: replied, replyRate: ratio(replied, threadsOpen.length) },
    blockedByReason,
    generatedAt: new Date().toISOString(),
  };
}

function csvCell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // spreadsheet-formula neutralisation
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function analyticsToCsv(a: CommunicationAnalytics): string {
  const rows: Array<[string, string, string | number | null]> = [];
  for (const [k, v] of Object.entries(a.totals)) rows.push(["totals", k, v]);
  for (const [k, v] of Object.entries(a.rates)) rows.push(["rates", k, v]);
  rows.push(["latency", "avgSecondsToSent", a.latency.avgSecondsToSent], ["latency", "p95SecondsToSent", a.latency.p95SecondsToSent]);
  for (const [ch, v] of Object.entries(a.byChannel)) for (const [m, n] of Object.entries(v)) rows.push([`channel:${ch}`, m, n]);
  for (const [p, v] of Object.entries(a.byProvider)) for (const [m, n] of Object.entries(v)) rows.push([`provider:${p}`, m, n]);
  for (const [k, v] of Object.entries(a.byMessageType)) rows.push(["messageType", k, v]);
  for (const [k, v] of Object.entries(a.blockedByReason)) rows.push(["blockedByReason", k, v]);
  rows.push(["suppressions", "added", a.suppressions.added], ["followUps", "created", a.followUps.created], ["followUps", "completed", a.followUps.completed]);
  return ["section,metric,value", ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

export function parseAnalyticsRange(from?: string | null, to?: string | null, now = new Date()): { from: Date; to: Date } {
  const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;
  const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
  const capped = end.getTime() - start.getTime() > 366 * 86_400_000 ? new Date(end.getTime() - 366 * 86_400_000) : start;
  return { from: capped, to: end };
}
