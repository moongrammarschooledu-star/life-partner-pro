import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { evaluateLaunchGovernance, scanCampaign } from "@/lib/marketing/campaign-service";
import { remainingBudgetMinor } from "@/lib/marketing/budget-service";
import type { Permission } from "@/lib/permissions";
import type { MarketingCampaign, MarketingCampaignStatus } from "@prisma/client";

// Read-side helpers for the campaign admin screens. Budget and spend fields are returned only to holders of
// marketing:budget:view; everyone else sees them as null (the server withholds them — the UI does not merely hide them).

export function toCampaignDto(c: MarketingCampaign, permissions: Permission[]) {
  const budgetVisible = permissions.includes("marketing:budget:view");
  return {
    id: c.id, code: c.code, name: c.name, description: c.description, objective: c.objective, channel: c.channel, status: c.status, providerKey: c.providerKey,
    campaignKey: c.campaignKey, utmSource: c.utmSource, utmMedium: c.utmMedium, contentIdentifier: c.contentIdentifier, timezone: c.timezone,
    startAt: c.startAt, endAt: c.endAt, language: c.language, landingPageId: c.landingPageId, formId: c.formId, routingDepartmentId: c.routingDepartmentId,
    assignedTeamId: c.assignedTeamId, responsibleAdminId: c.responsibleAdminId, attributionModel: c.attributionModel, notes: c.notes,
    createdById: c.createdById, submittedById: c.submittedById, approvedById: c.approvedById, approvedAt: c.approvedAt, launchedAt: c.launchedAt, pausedReason: c.pausedReason,
    targeting: c.targeting, createdAt: c.createdAt, updatedAt: c.updatedAt,
    budget: budgetVisible
      ? { currencyCode: c.currencyCode, totalMinor: c.budgetTotalMinor, dailyMinor: c.budgetDailyMinor, alertThresholdPct: c.alertThresholdPct, spendVerified: c.spendVerified, spendVerifiedMinor: c.spendVerified ? c.spendVerifiedMinor : null, remainingMinor: remainingBudgetMinor(c) }
      : null,
  };
}

export async function listCampaigns(permissions: Permission[], f: { status?: MarketingCampaignStatus; cursor?: string | null; take: number }) {
  const rows = await prisma.marketingCampaign.findMany({
    where: f.status ? { status: f.status } : {}, orderBy: { id: "desc" }, take: f.take + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, f.take);
  const counts = page.length ? await prisma.lead.groupBy({ by: ["campaignId"], where: { campaignId: { in: page.map((c) => c.id) } }, _count: { campaignId: true } }) : [];
  const leadCount = new Map(counts.map((c) => [c.campaignId, c._count.campaignId]));
  return { items: page.map((c) => ({ ...toCampaignDto(c, permissions), leadCount: leadCount.get(c.id) ?? 0 })), nextCursor: rows.length > f.take ? page[page.length - 1].id : null };
}

export async function getCampaignDetail(id: string, permissions: Permission[]) {
  const c = await prisma.marketingCampaign.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  const [adNodes, creatives, budgetEvents, page, form, governance, scan] = await Promise.all([
    prisma.marketingAdNode.findMany({ where: { campaignId: id }, orderBy: [{ level: "asc" }, { createdAt: "asc" }], take: 200 }),
    prisma.marketingCreative.findMany({ where: { campaignId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, code: true, name: true, status: true, headline: true, ctaLabel: true, language: true, createdById: true } }),
    permissions.includes("marketing:budget:view") ? prisma.marketingBudgetEvent.findMany({ where: { campaignId: id }, orderBy: { createdAt: "desc" }, take: 50 }) : Promise.resolve([]),
    c.landingPageId ? prisma.landingPage.findUnique({ where: { id: c.landingPageId }, select: { id: true, code: true, slug: true, name: true, status: true } }) : null,
    c.formId ? prisma.leadForm.findUnique({ where: { id: c.formId }, select: { id: true, code: true, name: true, status: true } }) : null,
    // The launch checklist: shown to anyone who can see the campaign so the editor knows what is blocking a launch.
    evaluateLaunchGovernance(c, { forResume: c.status !== "APPROVED" && c.status !== "SCHEDULED" }),
    scanCampaign(c),
  ]);
  return { campaign: toCampaignDto(c, permissions), adNodes, creatives, budgetEvents, landingPage: page, form, launchChecklist: governance, policyScan: { pass: scan.pass, findings: scan.findings, disclaimer: scan.disclaimer } };
}
