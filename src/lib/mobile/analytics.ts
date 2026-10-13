import { prisma } from "@/lib/prisma";
import { isValidVersion } from "@/lib/mobile/version";

// Privacy-conscious app analytics (STEP 37 §33). Counts only: per day, platform, app version and an event NAME from a fixed list. There is no person,
// profile, device, session, IP address or free text in anything stored or accepted here, so nothing about a proposal, a phone number or a family can leak.
// Off unless MOBILE_ANALYTICS_ENABLED=true.

export const MOBILE_EVENTS = [
  "APP_OPENED", "LOGIN_SUCCESS", "LOGIN_FAILED", "PROFILE_STARTED", "PROFILE_COMPLETED", "PROPOSAL_VIEWED", "PROPOSAL_RESPONDED", "MEETING_VIEWED",
  "NOTIFICATION_OPENED", "PUSH_RECEIVED", "SUPPORT_OPENED", "APP_UPDATE",
] as const;
export type MobileEventName = (typeof MOBILE_EVENTS)[number];

export const MAX_EVENTS_PER_REQUEST = 25;

export function analyticsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.MOBILE_ANALYTICS_ENABLED?.trim().toLowerCase() === "true";
}

/** Keeps only known event names, counts repeats, and caps the size. Everything else (extra fields, unknown names, free text) is dropped. */
export function sanitiseEvents(raw: unknown): Map<MobileEventName, number> {
  const out = new Map<MobileEventName, number>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const name = typeof item === "string" ? item : typeof item === "object" && item !== null ? (item as { name?: unknown }).name : undefined;
    if (typeof name === "string" && (MOBILE_EVENTS as readonly string[]).includes(name)) out.set(name as MobileEventName, (out.get(name as MobileEventName) ?? 0) + 1);
  }
  return out;
}

export async function recordMobileEvents(input: { platform: unknown; appVersion: unknown; events: unknown }, now: Date = new Date()): Promise<{ recorded: number }> {
  if (!analyticsEnabled()) return { recorded: 0 };
  if (input.platform !== "ANDROID" && input.platform !== "IOS") return { recorded: 0 };
  if (!isValidVersion(input.appVersion)) return { recorded: 0 };
  const counts = sanitiseEvents(input.events);
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let recorded = 0;
  for (const [event, count] of counts) {
    await prisma.mobileEventCounter.upsert({
      where: { day_platform_appVersion_event: { day, platform: input.platform, appVersion: input.appVersion, event } },
      update: { count: { increment: count } },
      create: { day, platform: input.platform, appVersion: input.appVersion, event, count },
    });
    recorded += count;
  }
  return { recorded };
}