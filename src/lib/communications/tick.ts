import { processCommunicationQueue, type QueueSummary } from "@/lib/communications/send-service";
import { runCampaignBatches } from "@/lib/communications/campaign-service";
import { runFollowUpAutomation, type FollowUpRunSummary } from "@/lib/communications/followup-automation";
import { expireSuppressions } from "@/lib/communications/suppression-service";
import { getProviderHealth, providerAlerts, type ProviderAlertCode } from "@/lib/communications/provider-health";

// The communication part of the single daily tick (Vercel Hobby allows one cron), also callable from the admin "process queue"
// action. Each step is isolated: one failing step never stops the others, and nothing here throws into the scheduler.

export interface CommunicationTickResult {
  queue: QueueSummary | null;
  campaigns: { started: number; batches: number } | null;
  followUps: FollowUpRunSummary | null;
  suppressionsExpired: number | null;
  providerAlerts: Array<{ providerKey: string; codes: ProviderAlertCode[] }>;
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

export async function runCommunicationTick(): Promise<CommunicationTickResult> {
  const errors: string[] = [];
  const queue = await step("queue", errors, () => processCommunicationQueue({ limit: 100, budgetMs: 30_000 }));
  const campaigns = await step("campaigns", errors, () => runCampaignBatches());
  const followUps = await step("follow-ups", errors, () => runFollowUpAutomation());
  const suppressionsExpired = await step("suppressions", errors, () => expireSuppressions());
  const { safeSweepCommunicationData } = await import("@/lib/communications/retention");
  await step("retention", errors, () => safeSweepCommunicationData());

  const alerts = (await step("provider-health", errors, async () => (await getProviderHealth()).map((row) => ({ providerKey: row.providerKey, codes: providerAlerts(row) })).filter((a) => a.codes.length > 0))) ?? [];
  if (alerts.length > 0) {
    await step("provider-alert", errors, async () => {
      const { notifyAdmins } = await import("@/lib/notifications/notification-service");
      await notifyAdmins({ type: "COMMUNICATION_PROVIDER_ALERT", data: {}, roles: ["COMMUNICATION_MANAGER", "COMPLIANCE_MANAGER", "OPERATIONS_ADMIN"] });
    });
  }
  return { queue, campaigns, followUps, suppressionsExpired, providerAlerts: alerts, errors };
}
