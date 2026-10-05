import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { MARKETING_FLAGS } from "@/lib/marketing/constants";
import { completeEndedCampaigns, startDueScheduledCampaigns } from "@/lib/marketing/campaign-service";
import { syncProviderMetrics } from "@/lib/marketing/provider-service";
import { runAutomationSweep } from "@/lib/marketing/automation";

// The marketing part of the single daily tick (Vercel Hobby allows one cron), also callable from an admin "run now"
// action. Every step is isolated and nothing throws into the scheduler. It can START an already-approved scheduled
// campaign, COMPLETE an ended one, sync verified metrics (which can only PAUSE at a budget cap), and run whitelisted
// automation. It can never launch an unapproved campaign, raise a budget, spend money or message anyone.
// Latency note: everything here runs once per day; submit-time work (assignment, task creation) is immediate.

export interface MarketingTickResult {
  skipped: boolean;
  scheduled: { started: number; parked: number } | null;
  completed: number | null;
  sync: { campaigns: number; rows: number; errors: number } | null;
  automation: { unresponded: number; profileIncomplete: number; verificationPending: number } | null;
  errors: string[];
}

async function step<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message.slice(0, 160) : "failed"}`);
    return null;
  }
}

export async function runMarketingTick(): Promise<MarketingTickResult> {
  const errors: string[] = [];
  if (!(await isFeatureEnabled(MARKETING_FLAGS.master))) return { skipped: true, scheduled: null, completed: null, sync: null, automation: null, errors };
  const scheduled = await step("scheduled-starts", errors, () => startDueScheduledCampaigns());
  const completed = await step("auto-complete", errors, () => completeEndedCampaigns());
  const sync = await step("provider-sync", errors, () => syncProviderMetrics());
  const automation = await step("automation", errors, () => runAutomationSweep());
  return { skipped: false, scheduled, completed, sync, automation, errors };
}
