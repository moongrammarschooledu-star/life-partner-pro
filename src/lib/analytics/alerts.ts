import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { sendNotification } from "@/lib/notifications/notification-service";
import { analyticsAudit } from "@/lib/analytics/audit";
import { metricAccessible, type Viewer } from "@/lib/analytics/access";
import { getMetric } from "@/lib/analytics/metrics/registry";
import { systemMetricValue } from "@/lib/analytics/query";
import { getAnalyticsSettings } from "@/lib/analytics/settings";
import { loadViewer } from "@/lib/analytics/viewers";
import { addDaysKey, dayKey } from "@/lib/analytics/time";
import type { AnalyticsSeverity } from "@prisma/client";

// STEP 31 — alert rules. A rule watches one catalog metric over a window and fires when it crosses a threshold. To avoid alarm
// fatigue: (1) a rule never fires on a sample smaller than its minimum sample, (2) an alert that is still open is not repeated,
// (3) after firing, the rule stays quiet for its cooldown. The window is rounded up to whole days (the job runs daily). Recipients
// get an in-app notice that names the rule and links to the alerts page — never any data.

export const OPERATORS = ["GT", "GTE", "LT", "LTE"] as const;
type Operator = (typeof OPERATORS)[number];
const SEVERITIES: AnalyticsSeverity[] = ["INFO", "WARNING", "CRITICAL"];

export function crosses(value: number, operator: Operator, threshold: number): boolean {
  return operator === "GT" ? value > threshold : operator === "GTE" ? value >= threshold : operator === "LT" ? value < threshold : value <= threshold;
}

export interface AlertRuleInput { name: string; metricKey: string; operator: string; threshold: number; windowHours?: number; minSample?: number; severity?: string; recipientAdminIds?: string[]; cooldownMinutes?: number }

async function validateRecipients(ids: string[] | undefined, metricKey: string): Promise<string[]> {
  const list = [...new Set(ids ?? [])].slice(0, 20);
  const def = getMetric(metricKey)!;
  const ok: string[] = [];
  for (const id of list) {
    const v = await loadViewer(id);
    if (v && v.active && metricAccessible(v, def)) ok.push(id); // only people who may see this metric can be told about it
  }
  return ok;
}

export async function createAlertRule(actor: Viewer, input: AlertRuleInput) {
  const def = getMetric(input.metricKey);
  if (!def) throw new HttpError(422, "Unknown metric.");
  if (!metricAccessible(actor, def)) throw new HttpError(403, "You cannot create an alert on a metric you cannot see.");
  if (!(OPERATORS as readonly string[]).includes(input.operator)) throw new HttpError(422, "Unknown operator.");
  if (typeof input.threshold !== "number" || !Number.isFinite(input.threshold)) throw new HttpError(422, "The threshold must be a number.");
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) throw new HttpError(422, "A name of 3-120 characters is required.");
  const windowHours = Math.min(Math.max(Math.trunc(input.windowHours ?? 24), 1), 24 * 90);
  const minSample = Math.min(Math.max(Math.trunc(input.minSample ?? 20), 1), 100_000);
  const cooldownMinutes = Math.min(Math.max(Math.trunc(input.cooldownMinutes ?? 720), 60), 60 * 24 * 30);
  const severity = (SEVERITIES as string[]).includes(input.severity ?? "") ? (input.severity as AnalyticsSeverity) : "WARNING";
  const recipients = await validateRecipients(input.recipientAdminIds, input.metricKey);
  const row = await prisma.analyticsAlertRule.create({ data: { name, metricKey: input.metricKey, operator: input.operator, threshold: input.threshold, windowHours, minSample, severity, cooldownMinutes, recipientAdminIds: recipients as never, createdById: actor.id } });
  await analyticsAudit({ action: "ANALYTICS_ALERT_RULE_CHANGED", actorId: actor.id, resource: "alert_rule", resourceId: row.id, after: { metricKey: input.metricKey, operator: input.operator, threshold: input.threshold, minSample, severity } });
  return row;
}

export async function setAlertRuleStatus(actor: Viewer, id: string, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
  const rule = await prisma.analyticsAlertRule.findUnique({ where: { id } });
  if (!rule) throw new HttpError(404, "Rule not found.");
  const row = await prisma.analyticsAlertRule.update({ where: { id }, data: { status } });
  await analyticsAudit({ action: "ANALYTICS_ALERT_RULE_CHANGED", actorId: actor.id, resource: "alert_rule", resourceId: id, before: { status: rule.status }, after: { status } });
  return row;
}

export async function acknowledgeAlert(actor: Viewer, eventId: string, resolve: boolean) {
  const ev = await prisma.analyticsAlertEvent.findUnique({ where: { id: eventId } });
  if (!ev) throw new HttpError(404, "Alert not found.");
  const row = await prisma.analyticsAlertEvent.update({ where: { id: eventId }, data: resolve ? { status: "RESOLVED", resolvedAt: new Date() } : { status: "ACKNOWLEDGED" } });
  await analyticsAudit({ action: "ANALYTICS_ALERT_RULE_CHANGED", actorId: actor.id, resource: "alert_event", resourceId: eventId, after: { status: row.status } });
  return row;
}

export interface AlertRunResult { evaluated: number; fired: number; skippedSmallSample: number; skippedCooldown: number; skippedOpen: number; autoResolved: number }

export async function evaluateAlertRules(now: Date = new Date()): Promise<AlertRunResult> {
  const result: AlertRunResult = { evaluated: 0, fired: 0, skippedSmallSample: 0, skippedCooldown: 0, skippedOpen: 0, autoResolved: 0 };
  if (!(await isFeatureEnabled("analytics.alerts.enabled"))) return result;
  const settings = await getAnalyticsSettings();
  const today = dayKey(now, settings.timezone);
  const rules = await prisma.analyticsAlertRule.findMany({ where: { status: "ACTIVE" }, take: 200 });
  for (const rule of rules) {
    const def = getMetric(rule.metricKey);
    if (!def) continue;
    result.evaluated++;
    const days = Math.max(1, Math.ceil(rule.windowHours / 24));
    // closed days only: the window ends yesterday so a half-finished day never raises an alert
    const toDay = addDaysKey(today, -1);
    const fromDay = addDaysKey(toDay, -(days - 1));
    let read: Awaited<ReturnType<typeof systemMetricValue>> = null;
    try {
      read = await systemMetricValue(rule.metricKey, fromDay, toDay, now);
    } catch {
      continue;
    }
    await prisma.analyticsAlertRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: now } });
    if (!read || read.display === null) { result.skippedSmallSample++; continue; }
    // sample = what the figure is based on: the denominator of a rate/duration, otherwise the count itself
    const sample = def.isRate || def.isDuration ? read.denominator ?? 0 : read.value ?? 0;
    const violating = crosses(read.display, rule.operator as Operator, rule.threshold);
    const open = await prisma.analyticsAlertEvent.findFirst({ where: { ruleId: rule.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { createdAt: "desc" } });
    if (!violating) {
      if (open) {
        await prisma.analyticsAlertEvent.update({ where: { id: open.id }, data: { status: "RESOLVED", resolvedAt: now } });
        result.autoResolved++;
      }
      continue;
    }
    if (sample < rule.minSample) { result.skippedSmallSample++; continue; }
    if (open) { result.skippedOpen++; continue; }
    if (rule.lastTriggeredAt && now.getTime() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60_000) { result.skippedCooldown++; continue; }
    const recipients = Array.isArray(rule.recipientAdminIds) ? (rule.recipientAdminIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const message = `${rule.name}: ${def.name} was ${read.display}${def.unit === "PERCENT" ? "%" : ""} (${rule.operator === "GT" || rule.operator === "GTE" ? "above" : "below"} ${rule.threshold}) over ${fromDay} to ${toDay}.`;
    const ev = await prisma.analyticsAlertEvent.create({ data: { ruleId: rule.id, observedValue: read.display, sample, severity: rule.severity, message: message.slice(0, 300), notified: recipients.length } });
    await prisma.analyticsAlertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now } });
    for (const adminId of recipients) await sendNotification({ adminId, type: "ANALYTICS_ALERT", data: {} });
    await analyticsAudit({ action: "ANALYTICS_ALERT_TRIGGERED", actorId: null, resource: "alert_rule", resourceId: rule.id, after: { eventId: ev.id, severity: rule.severity, sample } });
    result.fired++;
  }
  return result;
}

export async function listAlerts() {
  const [rules, events] = await Promise.all([
    prisma.analyticsAlertRule.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.analyticsAlertEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { rule: { select: { name: true, metricKey: true } } } }),
  ]);
  return { rules, events: events.map((e) => ({ id: e.id, ruleName: e.rule.name, metricKey: e.rule.metricKey, severity: e.severity, status: e.status, message: e.message, sample: e.sample, createdAt: e.createdAt })) };
}
