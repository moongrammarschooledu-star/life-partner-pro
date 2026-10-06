import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { analyticsAudit } from "@/lib/analytics/audit";
import { METRICS, getMetric } from "@/lib/analytics/metrics/registry";
import { versionNumber } from "@/lib/analytics/query-version";
import type { AnalyticsMetricStatus } from "@prisma/client";
import type { Viewer } from "@/lib/analytics/access";

// STEP 31 — metric catalog governance. The compute code is the canonical definition (src/lib/analytics/metrics/*); this service keeps
// the GOVERNANCE record for each metric in the database: owner, reviewer, review date, version history and status
//   DRAFT -> UNDER_REVIEW -> APPROVED -> ACTIVE -> (SUSPENDED | RETIRED)
// A reviewer can never be the owner/proposer. A SUSPENDED or RETIRED metric is refused by the query engine; every other status is
// usable but the catalog shows whether it has been reviewed. Installing creates rows for every code metric (as DRAFT) and never
// overwrites an existing row's status.

const ORDER: AnalyticsMetricStatus[] = ["DRAFT", "UNDER_REVIEW", "APPROVED", "ACTIVE"];
const BLOCKED: AnalyticsMetricStatus[] = ["SUSPENDED", "RETIRED"];

const blockedCache = new Map<string, { at: number; blocked: boolean }>();
export function clearCatalogCache(): void {
  blockedCache.clear();
}

export async function isMetricBlocked(key: string): Promise<boolean> {
  const hit = blockedCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.blocked;
  const row = await prisma.analyticsMetricDefinition.findUnique({ where: { key }, select: { status: true } });
  const blocked = !!row && BLOCKED.includes(row.status);
  blockedCache.set(key, { at: Date.now(), blocked });
  return blocked;
}

export async function installMetricCatalog(actorId: string): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const def of METRICS) {
    const found = await prisma.analyticsMetricDefinition.findUnique({ where: { key: def.key }, select: { id: true } });
    if (found) {
      existing++;
      continue;
    }
    const code = await nextSequenceCode("MET");
    await prisma.analyticsMetricDefinition.create({
      data: {
        key: def.key, code, name: def.name, description: def.description.slice(0, 600), category: def.section, unit: def.unit, kind: def.kind, ownerLabel: def.owner,
        versions: { create: { version: 1, status: "DRAFT", formula: def.formula.slice(0, 600), source: def.source.slice(0, 200), filters: def.filters as never, exclusions: def.exclusions as never, computeVersion: def.computeVersion, authorId: actorId, changeSummary: "Installed from the code catalog" } },
      },
    });
    created++;
  }
  if (created) await analyticsAudit({ action: "ANALYTICS_METRIC_CHANGED", actorId, resource: "metric_catalog", resourceId: "install", after: { created } });
  return { created, existing };
}

export async function listCatalog(viewerCanSee: (m: { section: string; requires: string[] }) => boolean) {
  const rows = await prisma.analyticsMetricDefinition.findMany({ orderBy: { key: "asc" }, take: 500, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return METRICS.filter((m) => viewerCanSee(m)).map((m) => {
    const row = byKey.get(m.key);
    return {
      key: m.key, name: m.name, description: m.description, section: m.section, unit: m.unit, kind: m.kind, formula: m.formula, source: m.source, filters: m.filters, exclusions: m.exclusions,
      dimensions: m.dimensions, note: m.note ?? null, computeVersion: m.computeVersion, liveOnly: !!m.liveOnly,
      governance: row ? { code: row.code, status: row.status, version: row.currentVersion, owner: row.ownerLabel, ownerAdminId: row.ownerAdminId, reviewerId: row.reviewerId, reviewedAt: row.reviewedAt } : null,
    };
  });
}

// move a metric one step along DRAFT -> UNDER_REVIEW -> APPROVED -> ACTIVE (or suspend/retire/reactivate)
export async function advanceMetric(actor: Viewer, key: string, action: "SUBMIT" | "APPROVE" | "ACTIVATE" | "SUSPEND" | "RETIRE" | "REACTIVATE", reason: string): Promise<{ key: string; status: AnalyticsMetricStatus }> {
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  if (!getMetric(key)) throw new HttpError(404, "Unknown metric.");
  const row = await prisma.analyticsMetricDefinition.findUnique({ where: { key }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!row) throw new HttpError(409, "Install the metric catalog first.");
  const author = row.versions[0]?.authorId ?? null;
  let next: AnalyticsMetricStatus;
  switch (action) {
    case "SUBMIT":
      if (row.status !== "DRAFT") throw new HttpError(409, "Only a draft can be submitted for review.");
      next = "UNDER_REVIEW";
      break;
    case "APPROVE":
      if (row.status !== "UNDER_REVIEW") throw new HttpError(409, "Only a metric under review can be approved.");
      if (actor.id === author || actor.id === row.ownerAdminId) throw new HttpError(403, "A metric cannot be approved by the person who wrote or owns it.");
      next = "APPROVED";
      break;
    case "ACTIVATE":
      if (row.status !== "APPROVED") throw new HttpError(409, "Only an approved metric can be activated.");
      next = "ACTIVE";
      break;
    case "SUSPEND":
      if (row.status !== "ACTIVE" && row.status !== "APPROVED") throw new HttpError(409, "Only an active or approved metric can be suspended.");
      next = "SUSPENDED";
      break;
    case "RETIRE":
      if (row.status === "RETIRED") throw new HttpError(409, "Already retired.");
      next = "RETIRED";
      break;
    case "REACTIVATE":
      if (row.status !== "SUSPENDED") throw new HttpError(409, "Only a suspended metric can be reactivated.");
      next = "ACTIVE";
      break;
  }
  const reviewing = action === "APPROVE";
  await prisma.analyticsMetricDefinition.update({ where: { id: row.id }, data: { status: next, ...(reviewing ? { reviewerId: actor.id, reviewedAt: new Date() } : {}) } });
  if (row.versions[0]) await prisma.analyticsMetricVersion.update({ where: { id: row.versions[0].id }, data: { status: next, ...(reviewing ? { reviewerId: actor.id, reviewedAt: new Date() } : {}) } });
  clearCatalogCache();
  await analyticsAudit({ action: reviewing ? "ANALYTICS_METRIC_REVIEWED" : "ANALYTICS_METRIC_CHANGED", actorId: actor.id, resource: "metric", resourceId: key, before: { status: row.status }, after: { status: next }, reason });
  return { key, status: next };
}

export async function setMetricOwner(actor: Viewer, key: string, ownerAdminId: string | null, ownerLabel: string | null): Promise<void> {
  const row = await prisma.analyticsMetricDefinition.findUnique({ where: { key }, select: { id: true } });
  if (!row) throw new HttpError(409, "Install the metric catalog first.");
  await prisma.analyticsMetricDefinition.update({ where: { id: row.id }, data: { ownerAdminId, ownerLabel: ownerLabel?.slice(0, 80) ?? null } });
  await analyticsAudit({ action: "ANALYTICS_METRIC_CHANGED", actorId: actor.id, resource: "metric", resourceId: key, after: { ownerAdminId, ownerLabel } });
}

export { ORDER as METRIC_STATUS_ORDER, versionNumber };
