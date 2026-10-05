import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { marketingAudit } from "@/lib/marketing/audit";
import { assertApprovedPayloadMatches, gateMarketingAction } from "@/lib/marketing/approval";
import { MAX_BUDGET_MINOR } from "@/lib/marketing/constants";
import { getMarketingAdapter } from "@/lib/marketing/providers/registry";
import { pauseCampaign } from "@/lib/marketing/campaign-service";
import type { SessionAdmin } from "@/lib/route-guard";
import type { MarketingCampaign } from "@prisma/client";

// STEP 29 §29 — budget governance, enforced server-side only. Before a campaign has launched its budget is an
// ordinary edit (nothing can have been spent; a material edit already invalidates any approval). Once it has
// launched, an INCREASE goes through the STEP 19 gate (amount-tiered, delta in minor units, TOCTOU re-checked) while a
// decrease is applied directly. Spend arrives from the provider sync as VERIFIED spend; reaching the cap pauses the
// campaign (a spend-reducing action, so automation may do it) — it never raises a budget.

const LAUNCHED = ["SCHEDULED", "ACTIVE", "PAUSED"] as const;

export type BudgetOutcome = { approvalRequired: false; campaign: MarketingCampaign } | { approvalRequired: true; approvalCode: string; status: string };

export async function changeCampaignBudget(actor: SessionAdmin, campaignId: string, input: { newTotalMinor: number; newDailyMinor?: number | null; reason: string }): Promise<BudgetOutcome> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new HttpError(422, "A reason is required.");
  const total = input.newTotalMinor;
  if (!Number.isInteger(total) || total < 1 || total > MAX_BUDGET_MINOR) throw new HttpError(422, "Invalid total budget.");
  const c = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!c) throw new HttpError(404, "Campaign not found.");
  if (c.status === "ARCHIVED" || c.status === "COMPLETED") throw new HttpError(409, "This campaign's budget can no longer be changed.");
  const daily = input.newDailyMinor === undefined ? c.budgetDailyMinor : input.newDailyMinor;
  if (daily != null && (!Number.isInteger(daily) || daily < 1 || daily > total)) throw new HttpError(422, "The daily budget must be a positive whole number no larger than the total.");
  if (c.spendVerified && total < c.spendVerifiedMinor) throw new HttpError(422, "The total budget cannot be lower than the verified spend so far.");

  const launched = (LAUNCHED as readonly string[]).includes(c.status);
  const totalDelta = total - c.budgetTotalMinor;
  const dailyIncrease = daily != null && (c.budgetDailyMinor == null || daily > c.budgetDailyMinor);
  const isIncrease = totalDelta > 0 || (launched && dailyIncrease);

  if (!launched) {
    // Pre-launch: plain edit. A material edit resets any review/approval (updateCampaign's rule, applied here directly).
    const reset = c.status === "IN_REVIEW" || c.status === "APPROVED";
    const updated = await prisma.marketingCampaign.update({
      where: { id: campaignId },
      data: { budgetTotalMinor: total, budgetDailyMinor: daily, ...(reset ? { status: "DRAFT", submittedById: null, approvedById: null, approvedAt: null, contentHash: null, policyScanAt: null } : {}) },
    });
    await prisma.marketingBudgetEvent.create({ data: { campaignId, type: totalDelta >= 0 ? "SET" : "DECREASE", amountMinor: Math.abs(totalDelta), previousMinor: c.budgetTotalMinor, newMinor: total, currencyCode: c.currencyCode, actorId: actor.id, note: reason } });
    await marketingAudit({ action: "MARKETING_BUDGET_CHANGED", actorId: actor.id, resource: "campaign", resourceId: campaignId, before: { total: c.budgetTotalMinor, daily: c.budgetDailyMinor }, after: { total, daily, approvalReset: reset }, reason });
    return { approvalRequired: false, campaign: updated };
  }

  let approvalCode: string | null = null;
  let approvalRequestId: string | null = null;
  if (isIncrease) {
    const payload = { campaignId, newTotalMinor: total, newDailyMinor: daily ?? null };
    const gate = await gateMarketingAction({
      actionType: "MARKETING_BUDGET_INCREASE",
      sourceId: `budget:${campaignId}:${total}:${daily ?? "none"}`,
      actor,
      reason,
      context: { amountMinor: Math.max(totalDelta, 1), currencyCode: c.currencyCode },
      requestedPayload: payload,
      currentStatePayload: { total: c.budgetTotalMinor, daily: c.budgetDailyMinor },
    });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") {
      await prisma.marketingBudgetEvent.create({ data: { campaignId, type: "INCREASE_REQUESTED", amountMinor: Math.max(totalDelta, 0), previousMinor: c.budgetTotalMinor, newMinor: total, currencyCode: c.currencyCode, approvalRequestId: gate.approvalRequestId, actorId: actor.id, note: reason } });
      await marketingAudit({ action: "MARKETING_BUDGET_INCREASE_REQUESTED", actorId: actor.id, resource: "campaign", resourceId: campaignId, before: { total: c.budgetTotalMinor }, after: { requestedTotal: total }, reason, approvalId: gate.approvalCode });
      return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    }
    if (gate.requiresApproval) {
      await assertApprovedPayloadMatches(gate.approvalRequestId, payload);
      approvalCode = gate.approvalCode;
      approvalRequestId = gate.approvalRequestId;
    } else {
      // The base policy is LEVEL_1, so this means an admin disabled the policy. A live-campaign increase still must not
      // be a one-person action: require an explicit independent approver recorded on the campaign.
      if (!c.approvedById || c.approvedById === actor.id) throw new HttpError(403, "A budget increase on a launched campaign needs an independent approval.");
    }
  }

  // Push the new cap to the provider BEFORE recording it locally, so a provider failure leaves nothing half-changed.
  if (c.providerKey !== "SANDBOX") {
    const node = await prisma.marketingAdNode.findFirst({ where: { campaignId, level: "AD_CAMPAIGN", providerKey: c.providerKey } });
    if (node?.externalId) {
      try {
        await getMarketingAdapter(c.providerKey).updateCampaign(node.externalId, { dailyBudgetMinor: daily ?? undefined });
      } catch {
        throw new HttpError(502, "The ad provider could not apply the new budget. Nothing was changed.");
      }
    }
  }

  const updated = await prisma.marketingCampaign.update({ where: { id: campaignId }, data: { budgetTotalMinor: total, budgetDailyMinor: daily } });
  await prisma.marketingBudgetEvent.create({
    data: { campaignId, type: isIncrease ? "INCREASE_APPROVED" : "DECREASE", amountMinor: Math.abs(totalDelta), previousMinor: c.budgetTotalMinor, newMinor: total, currencyCode: c.currencyCode, approvalRequestId, actorId: actor.id, note: reason },
  });
  if (approvalRequestId) await markApprovalExecuted(approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_BUDGET_CHANGED", actorId: actor.id, resource: "campaign", resourceId: campaignId, before: { total: c.budgetTotalMinor, daily: c.budgetDailyMinor }, after: { total, daily }, reason, approvalId: approvalCode });
  return { approvalRequired: false, campaign: updated };
}

export function remainingBudgetMinor(c: Pick<MarketingCampaign, "budgetTotalMinor" | "spendVerified" | "spendVerifiedMinor">): number | null {
  // Remaining is only knowable from VERIFIED spend; otherwise report null rather than pretend the whole budget is left.
  return c.spendVerified ? Math.max(0, c.budgetTotalMinor - c.spendVerifiedMinor) : null;
}

// Called by the provider sync with the provider's own cumulative spend. Writes the ledger entry, raises a one-time
// alert at the threshold, and pauses the campaign when the cap is reached.
export async function recordVerifiedSpend(campaignId: string, cumulativeSpendMinor: number): Promise<{ alerted: boolean; paused: boolean }> {
  const c = await prisma.marketingCampaign.findUnique({ where: { id: campaignId } });
  if (!c) return { alerted: false, paused: false };
  if (!Number.isInteger(cumulativeSpendMinor) || cumulativeSpendMinor < 0) return { alerted: false, paused: false };
  if (cumulativeSpendMinor === c.spendVerifiedMinor && c.spendVerified) return { alerted: false, paused: false };

  await prisma.marketingCampaign.update({ where: { id: campaignId }, data: { spendVerifiedMinor: cumulativeSpendMinor, spendVerified: true } });
  await prisma.marketingBudgetEvent.create({ data: { campaignId, type: "SPEND_SYNCED", amountMinor: cumulativeSpendMinor, previousMinor: c.spendVerifiedMinor, newMinor: cumulativeSpendMinor, currencyCode: c.currencyCode, note: "Provider-reported cumulative spend" } });

  let alerted = false;
  if (c.alertThresholdPct && c.budgetTotalMinor > 0 && cumulativeSpendMinor * 100 >= c.budgetTotalMinor * c.alertThresholdPct) {
    const already = await prisma.marketingBudgetEvent.count({ where: { campaignId, type: "ALERT" } });
    if (already === 0) {
      await prisma.marketingBudgetEvent.create({ data: { campaignId, type: "ALERT", amountMinor: cumulativeSpendMinor, newMinor: c.budgetTotalMinor, currencyCode: c.currencyCode, note: `Spend reached ${c.alertThresholdPct}% of the total budget` } });
      alerted = true;
    }
  }

  let paused = false;
  if (cumulativeSpendMinor >= c.budgetTotalMinor && c.status === "ACTIVE") {
    try {
      await pauseCampaign(null, campaignId, "BUDGET_EXHAUSTED");
      paused = true;
    } catch (e) {
      console.error("[marketing] budget-cap pause failed", e instanceof Error ? e.message : e);
    }
  }
  return { alerted, paused };
}
