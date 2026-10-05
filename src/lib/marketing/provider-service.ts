import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { marketingAudit } from "@/lib/marketing/audit";
import { gateMarketingAction } from "@/lib/marketing/approval";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { recordVerifiedSpend } from "@/lib/marketing/budget-service";
import { MetaAdsAdapter, META_SECRET_NAMES } from "@/lib/marketing/providers/meta";
import { getMarketingAdapter, IMPLEMENTED_PROVIDERS } from "@/lib/marketing/providers/registry";
import type { SessionAdmin } from "@/lib/route-guard";
import type { MarketingProviderKey } from "@prisma/client";

// STEP 29 §6/§7 — provider connections. Secrets live in environment variables; this module only ever reads which
// variable NAMES are present (booleans) — values are never read into a response, a log or the database. Connecting,
// changing or disconnecting a provider is a STEP 19-gated, audited action. The nightly sync pulls metrics and verified
// spend for launched campaigns.

const ALL_PROVIDERS: MarketingProviderKey[] = ["SANDBOX", "META", "GOOGLE", "TIKTOK"];
const SECRET_NAMES: Record<MarketingProviderKey, readonly string[]> = { SANDBOX: [], META: META_SECRET_NAMES, GOOGLE: [], TIKTOK: [] };

export interface ProviderStatusView {
  providerKey: MarketingProviderKey;
  implemented: boolean;
  usesSandboxAdapter: boolean;
  secretsPresent: Record<string, boolean>; // name → set? (never the value)
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  webhookStatus: string | null;
  lastWebhookAt: Date | null;
}

export async function listProviderStatuses(env: Record<string, string | undefined> = process.env): Promise<ProviderStatusView[]> {
  const rows = await prisma.marketingProviderConnection.findMany();
  return ALL_PROVIDERS.map((key) => {
    const row = rows.find((r) => r.providerKey === key);
    const implemented = IMPLEMENTED_PROVIDERS.includes(key);
    return {
      providerKey: key,
      implemented,
      usesSandboxAdapter: getMarketingAdapter(key, env).sandbox,
      secretsPresent: Object.fromEntries(SECRET_NAMES[key].map((n) => [n, !!env[n]?.trim()])),
      status: key === "SANDBOX" ? "CONNECTED" : implemented ? (row?.status ?? "NOT_CONFIGURED") : "NOT_CONFIGURED",
      lastSyncAt: row?.lastSyncAt ?? null,
      lastError: row?.lastError ?? null,
      webhookStatus: row?.webhookStatus ?? null,
      lastWebhookAt: row?.lastWebhookAt ?? null,
    };
  });
}

export type ProviderChangeOutcome = { approvalRequired: false; status: string } | { approvalRequired: true; approvalCode: string; status: string };

export async function connectProvider(actor: SessionAdmin, key: MarketingProviderKey, reason: string): Promise<ProviderChangeOutcome> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  if (!IMPLEMENTED_PROVIDERS.includes(key)) throw new HttpError(422, "This provider is not implemented yet.");
  if (key === "SANDBOX") return { approvalRequired: false, status: "CONNECTED" };

  const gate = await gateMarketingAction({ actionType: "MARKETING_PROVIDER_CONNECTION_CHANGE", sourceId: `provider:${key}:connect`, actor, reason, requestedPayload: { providerKey: key, change: "CONNECT" } });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };

  // An explicit admin validation call may use the real adapter in any environment (it is a read-only account lookup).
  const adapter = new MetaAdsAdapter();
  const check = adapter.isConfigured() ? await adapter.validateCredentials() : { ok: false, message: "Required environment variables are not set." };
  const status = check.ok ? "CONNECTED" : adapter.isConfigured() ? "ERROR" : "NOT_CONFIGURED";
  await prisma.marketingProviderConnection.upsert({
    where: { providerKey: key },
    create: { providerKey: key, status, secretRefs: [...META_SECRET_NAMES] as never, environment: "PRODUCTION", lastError: check.ok ? null : (check.message ?? "").slice(0, 300), updatedById: actor.id },
    update: { status, secretRefs: [...META_SECRET_NAMES] as never, lastError: check.ok ? null : (check.message ?? "").slice(0, 300), updatedById: actor.id },
  });
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_PROVIDER_CHANGED", actorId: actor.id, resource: "provider", resourceId: key, after: { status }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, status };
}

export async function disconnectProvider(actor: SessionAdmin, key: MarketingProviderKey, reason: string): Promise<ProviderChangeOutcome> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  if (key === "SANDBOX") throw new HttpError(409, "The sandbox adapter cannot be disconnected.");
  const live = await prisma.marketingCampaign.count({ where: { providerKey: key, status: { in: ["ACTIVE", "SCHEDULED"] } } });
  if (live > 0) throw new HttpError(409, "Pause or complete this provider's active campaigns before disconnecting it.");
  const gate = await gateMarketingAction({ actionType: "MARKETING_PROVIDER_CONNECTION_CHANGE", sourceId: `provider:${key}:disconnect`, actor, reason, requestedPayload: { providerKey: key, change: "DISCONNECT" } });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  await prisma.marketingProviderConnection.upsert({
    where: { providerKey: key },
    create: { providerKey: key, status: "DISABLED", updatedById: actor.id },
    update: { status: "DISABLED", updatedById: actor.id },
  });
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_PROVIDER_CHANGED", actorId: actor.id, resource: "provider", resourceId: key, after: { status: "DISABLED" }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, status: "DISABLED" };
}

// Pulls the last 7 days of daily metrics for every launched campaign on a live provider, upserts the daily rows, then
// reports the provider's CUMULATIVE spend as verified spend (which can alert and pause at the cap — never raise a budget).
export async function syncProviderMetrics(now = new Date()): Promise<{ campaigns: number; rows: number; errors: number }> {
  const out = { campaigns: 0, rows: 0, errors: 0 };
  if (!(await isFeatureEnabled(MARKETING_FLAGS.master)) || !(await isFeatureEnabled(MARKETING_FLAGS.providerSync))) return out;
  const nodes = await prisma.marketingAdNode.findMany({
    where: { level: "AD_CAMPAIGN", providerKey: { not: "SANDBOX" }, externalId: { not: null }, campaign: { status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } } },
    include: { campaign: true },
    take: 200,
  });
  for (const node of nodes) {
    const adapter = getMarketingAdapter(node.providerKey);
    if (adapter.sandbox) continue; // never synthesise numbers outside production / without credentials
    out.campaigns++;
    try {
      const rows = await adapter.getCampaignMetrics(node.externalId as string, { from: new Date(now.getTime() - 7 * 86_400_000), to: now });
      for (const r of rows) {
        const date = new Date(`${r.date}T00:00:00.000Z`);
        await prisma.marketingMetricDaily.upsert({
          where: { campaignId_adNodeKey_date: { campaignId: node.campaignId, adNodeKey: "CAMPAIGN", date } },
          create: { campaignId: node.campaignId, adNodeKey: "CAMPAIGN", date, providerKey: node.providerKey, impressions: r.impressions, reach: r.reach, clicks: r.clicks, spendMinor: r.spendMinor, providerLeads: r.providerLeads, isSandbox: false },
          update: { impressions: r.impressions, reach: r.reach, clicks: r.clicks, spendMinor: r.spendMinor, providerLeads: r.providerLeads },
        });
        out.rows++;
      }
      const total = await prisma.marketingMetricDaily.aggregate({ where: { campaignId: node.campaignId, isSandbox: false }, _sum: { spendMinor: true } });
      await recordVerifiedSpend(node.campaignId, total._sum.spendMinor ?? 0);
      await prisma.marketingAdNode.update({ where: { id: node.id }, data: { lastSyncedAt: now } });
      await prisma.marketingProviderConnection.updateMany({ where: { providerKey: node.providerKey }, data: { lastSyncAt: now, lastError: null } });
    } catch (e) {
      out.errors++;
      await prisma.marketingProviderConnection.updateMany({ where: { providerKey: node.providerKey }, data: { status: "ERROR", lastError: (e instanceof Error ? e.message : "SYNC_ERROR").slice(0, 300) } }).catch(() => undefined);
    }
  }
  return out;
}
