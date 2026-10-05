import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { ENGAGEMENT_FLAGS } from "@/lib/engagement/constants";
import { advanceAnnouncementWindows } from "@/lib/engagement/announcement-service";
import { writeDailySnapshot } from "@/lib/engagement/analytics";
import { deliverDueReminders, runReengagementSweep } from "@/lib/engagement/reengagement";
import { advanceDueRuns } from "@/lib/engagement/workflow-runner";

// STEP 30 - the engagement part of the single daily tick (Vercel Hobby allows one cron), also callable from the admin
// "Run now" action. Order matters: detect -> advance workflows -> deliver due reminders -> windows -> snapshot.
// Every step is isolated and nothing throws into the scheduler. This tick can only RECORD events, advance already-published
// workflows, and ask deliver.ts to send reminders (which applies the full no-spam gate). It cannot publish, approve or change
// anything about a proposal, a profile or money.
// Latency note: everything here runs once a day, so a "wait 72 hours" step is honoured at the first tick after 72 hours.

export interface EngagementTickResult {
  skipped: boolean;
  sweep: Awaited<ReturnType<typeof runReengagementSweep>> | null;
  runs: { advanced: number; failed: number } | null;
  reminders: { examined: number; sent: number; deferred: number; closed: number } | null;
  announcements: { started: number; expired: number } | null;
  snapshotRows: number | null;
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

export async function runEngagementTick(now: Date = new Date()): Promise<EngagementTickResult> {
  const errors: string[] = [];
  if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master))) return { skipped: true, sweep: null, runs: null, reminders: null, announcements: null, snapshotRows: null, errors };
  const sweep = await step("sweep", errors, () => runReengagementSweep(now));
  const runs = await step("runs", errors, () => advanceDueRuns(now));
  const reminders = await step("reminders", errors, () => deliverDueReminders(now));
  const announcements = await step("announcements", errors, () => advanceAnnouncementWindows(now));
  const snapshotRows = await step("snapshot", errors, () => writeDailySnapshot(now));
  return { skipped: false, sweep, runs, reminders, announcements, snapshotRows, errors };
}
