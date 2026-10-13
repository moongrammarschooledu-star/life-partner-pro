import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { getSettingValues } from "@/lib/platform/settings";
import { markTokenInvalid, tokenOf } from "@/lib/mobile/device-service";
import { buildPushContent, effectiveMode, isPushableCategory, type PushContent } from "@/lib/mobile/push/payload";
import { providerForPlatform } from "@/lib/mobile/push/registry";
import { inQuietHours, quietHoursApply } from "@/lib/mobile/push/quiet-hours";
import type { PushOutcome } from "@/lib/mobile/push/types";

// Sends a push notification for an in-app notification that was just created (STEP 37 §12–§13). It never decides to notify on its own: it only mirrors a
// notification the platform already decided to create, and it applies the person's own choices on top. Fail-open: a push problem never affects the
// notification itself or the workflow that raised it.

export const MAX_PUSH_PER_DEVICE_PER_HOUR = 20;

export interface PushSource {
  id: string;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  category: string | null;
  priority: string | null;
  profileId?: string | null;
  familyMemberId?: string | null;
}

export interface PushSummary {
  considered: number;
  sent: number;
  skipped: number;
  invalidated: number;
  failed: number;
}

const EMPTY: PushSummary = { considered: 0, sent: 0, skipped: 0, invalidated: 0, failed: 0 };

async function record(deviceId: string, n: PushSource, status: "SENT" | "FAILED" | "INVALID_TOKEN" | "SKIPPED", reason?: string, providerMessageId?: string) {
  await prisma.mobilePushDelivery.create({ data: { deviceId, notificationId: n.id, notificationType: n.type.slice(0, 60), status, reason: reason?.slice(0, 60) ?? null, providerMessageId: providerMessageId ?? null } }).catch(() => {});
}

export async function dispatchPushForNotification(n: PushSource, now: Date = new Date()): Promise<PushSummary> {
  const summary = { ...EMPTY };
  try {
    if (!n.profileId && !n.familyMemberId) return summary;
    if (!(await isFeatureEnabled("mobile.push.enabled")) || !(await isFeatureEnabled("mobile.app.enabled")) || !(await isFeatureEnabled("notifications.enabled"))) return summary;
    if (!isPushableCategory(n.category, n.priority)) return summary;

    const devices = await prisma.mobileDevice.findMany({
      where: { status: "ACTIVE", pushTokenEnc: { not: null }, ...(n.profileId ? { profileId: n.profileId } : { familyMemberId: n.familyMemberId as string }) },
      take: 20,
    });
    if (devices.length === 0) return summary;
    summary.considered = devices.length;

    let accountMode: string | null = null;
    if (n.profileId) {
      const profileId = n.profileId;
      // An account that is locked out gets nothing outside the app either.
      if ((await hasActiveRestriction(profileId, "LOGIN_RESTRICTED")) || (await hasActiveRestriction(profileId, "FULL_ACCOUNT_RESTRICTED"))) {
        for (const d of devices) await record(d.id, n, "SKIPPED", "account_restricted");
        summary.skipped = devices.length;
        return summary;
      }
      const prefs = await prisma.notificationPreference.findUnique({ where: { profileId }, select: { inAppProposalUpdates: true, inAppMeetingUpdates: true, pushDisplayMode: true } });
      accountMode = prefs?.pushDisplayMode ?? null;
      const blocked = (n.category === "PROPOSAL" && prefs?.inAppProposalUpdates === false) || (n.category === "MEETING" && prefs?.inAppMeetingUpdates === false);
      if (blocked) {
        for (const d of devices) await record(d.id, n, "SKIPPED", "preference_off");
        summary.skipped = devices.length;
        return summary;
      }
    }

    if (quietHoursApply(n.priority)) {
      const [settings, values] = await Promise.all([prisma.appSettings.findUnique({ where: { id: 1 }, select: { quietHoursStart: true, quietHoursEnd: true } }), getSettingValues()]);
      const tz = typeof values["localization.timezone"] === "string" ? (values["localization.timezone"] as string) : "Asia/Karachi";
      if (inQuietHours(now, settings?.quietHoursStart, settings?.quietHoursEnd, tz)) {
        for (const d of devices) await record(d.id, n, "SKIPPED", "quiet_hours");
        summary.skipped = devices.length;
        return summary;
      }
    }

    const hourAgo = new Date(now.getTime() - 3_600_000);
    for (const d of devices) {
      const mode = effectiveMode(d.displayMode, accountMode);
      const content: PushContent | null = buildPushContent(mode, { title: n.title, body: n.body }, n.id, n.actionUrl);
      if (!content) {
        await record(d.id, n, "SKIPPED", "display_off");
        summary.skipped++;
        continue;
      }
      // Never spam a phone: a cap per device per hour, whatever the number of notifications raised.
      if ((await prisma.mobilePushDelivery.count({ where: { deviceId: d.id, status: "SENT", createdAt: { gte: hourAgo } } })) >= MAX_PUSH_PER_DEVICE_PER_HOUR) {
        await record(d.id, n, "SKIPPED", "rate_limited");
        summary.skipped++;
        continue;
      }
      const provider = providerForPlatform(d.platform);
      if (!provider.isConfigured()) {
        await record(d.id, n, "SKIPPED", "provider_not_configured");
        summary.skipped++;
        continue;
      }
      const token = tokenOf(d);
      if (!token) {
        await record(d.id, n, "SKIPPED", "token_unreadable");
        summary.skipped++;
        continue;
      }
      const outcome: PushOutcome = await provider.send(token, content);
      if (outcome.status === "SENT") {
        await record(d.id, n, "SENT", undefined, outcome.providerMessageId);
        summary.sent++;
      } else if (outcome.status === "INVALID_TOKEN") {
        await record(d.id, n, "INVALID_TOKEN", outcome.reason);
        await markTokenInvalid(d.id);
        summary.invalidated++;
      } else {
        await record(d.id, n, "FAILED", outcome.reason);
        summary.failed++;
      }
    }
    return summary;
  } catch {
    return summary;
  }
}

/** A fixed, generic test message to one device. Used by "send a test notification" for the person's own device and by the admin test. */
export async function sendTestPush(deviceId: string): Promise<{ status: PushOutcome["status"] | "NOT_CONFIGURED" | "NO_TOKEN"; reason?: string }> {
  const device = await prisma.mobileDevice.findUnique({ where: { id: deviceId } });
  if (!device || device.status !== "ACTIVE") return { status: "NO_TOKEN" };
  const token = tokenOf(device);
  if (!token) return { status: "NO_TOKEN" };
  const provider = providerForPlatform(device.platform);
  if (!provider.isConfigured()) return { status: "NOT_CONFIGURED" };
  const outcome = await provider.send(token, { title: "Life Partner Pro", body: "This is a test notification. Nothing needs your attention.", data: { n: "test", p: "/dashboard" } });
  await prisma.mobilePushDelivery.create({ data: { deviceId, notificationId: null, notificationType: "TEST", status: outcome.status === "SENT" ? "SENT" : outcome.status === "INVALID_TOKEN" ? "INVALID_TOKEN" : "FAILED", reason: outcome.status === "SENT" ? null : outcome.reason.slice(0, 60), providerMessageId: outcome.status === "SENT" ? (outcome.providerMessageId ?? null) : null } }).catch(() => {});
  if (outcome.status === "INVALID_TOKEN") await markTokenInvalid(deviceId);
  return outcome.status === "SENT" ? { status: "SENT" } : { status: outcome.status, reason: outcome.reason };
}