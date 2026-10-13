import { prisma } from "@/lib/prisma";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { getAllFeatureFlags } from "@/lib/ops/feature-flags";
import { analyticsEnabled } from "@/lib/mobile/analytics";
import { androidCertFingerprints, appleTeamId, mobileIdentity } from "@/lib/mobile/config";
import { getVersionPolicy } from "@/lib/mobile/version-service";
import { listReleases } from "@/lib/mobile/release-service";
import { getPushProvider } from "@/lib/mobile/push/registry";
import { associatedPathPatterns } from "@/lib/mobile/deep-link";

// The Control Center "Mobile Apps" page (STEP 37 §42–§43). Counts, statuses and safe metadata only: no push token, no person's name, no contact detail. Each
// figure is read at request time; one that cannot be read shows as null, never as a guess.

const DAY = 86_400_000;
const MOBILE_EVENT_TYPES = [
  "MOBILE_DEVICE_REGISTERED", "MOBILE_DEVICE_REMOVED", "MOBILE_SESSION_CREATED", "MOBILE_SESSION_REVOKED", "MOBILE_PUSH_TOKEN_CHANGED", "MOBILE_LOGIN_FAILED",
  "MOBILE_BIOMETRIC_ENABLED", "MOBILE_BIOMETRIC_DISABLED", "MOBILE_DEEP_LINK_OPENED", "MOBILE_APP_UPDATED", "MOBILE_SECURITY_WARNING",
] as const;

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export async function mobileOverview(now: Date = new Date()) {
  const since24 = new Date(now.getTime() - DAY);
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const id = mobileIdentity();
  const fcm = getPushProvider("FCM");
  const apns = getPushProvider("APNS");

  const [flags, android, ios, byPlatform, activeLast30, withPush, invalid, versions, pushStatus, pushReasons, events, deepLinks, releases, errors, usage] = await Promise.all([
    safe(() => getAllFeatureFlags()),
    safe(() => getVersionPolicy("ANDROID")),
    safe(() => getVersionPolicy("IOS")),
    safe(() => prisma.mobileDevice.groupBy({ by: ["platform"], where: { status: "ACTIVE" }, _count: { _all: true } })),
    safe(() => prisma.mobileDevice.count({ where: { status: "ACTIVE", lastSeenAt: { gte: since30 } } })),
    safe(() => prisma.mobileDevice.count({ where: { status: "ACTIVE", pushTokenEnc: { not: null } } })),
    safe(() => prisma.mobileDevice.count({ where: { status: "TOKEN_INVALID" } })),
    safe(() => prisma.mobileDevice.groupBy({ by: ["platform", "appVersion"], where: { status: "ACTIVE" }, _count: { _all: true }, orderBy: { _count: { appVersion: "desc" } }, take: 12 })),
    safe(() => prisma.mobilePushDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: since24 } }, _count: { _all: true } })),
    safe(() => prisma.mobilePushDelivery.groupBy({ by: ["reason"], where: { createdAt: { gte: since24 }, status: { not: "SENT" } }, _count: { _all: true }, orderBy: { _count: { reason: "desc" } }, take: 6 })),
    safe(() => prisma.securityEvent.groupBy({ by: ["eventType"], where: { eventType: { in: [...MOBILE_EVENT_TYPES] }, createdAt: { gte: since24 } }, _count: { _all: true } })),
    safe(() => prisma.securityEvent.groupBy({ by: ["outcome"], where: { eventType: "MOBILE_DEEP_LINK_OPENED", createdAt: { gte: since24 } }, _count: { _all: true } })),
    safe(() => listReleases(20)),
    safe(() => prisma.errorEvent.findMany({ where: { service: { in: ["MOBILE_ANDROID", "MOBILE_IOS"] }, lastSeenAt: { gte: since7 } }, orderBy: { lastSeenAt: "desc" }, take: 10, select: { id: true, service: true, severity: true, route: true, message: true, occurrences: true, lastSeenAt: true, status: true } })),
    analyticsEnabled() ? safe(() => prisma.mobileEventCounter.groupBy({ by: ["event"], where: { day: { gte: since7 } }, _sum: { count: true } })) : Promise.resolve(null),
  ]);

  const count = (rows: Array<{ platform: string; _count: { _all: number } }> | null, p: string) => rows?.find((r) => r.platform === p)?._count._all ?? 0;
  return {
    generatedAt: now.toISOString(),
    identity: { appName: id.appName, androidPackageId: id.androidPackageId, iosBundleId: id.iosBundleId, hosts: id.appHosts, appUrl: id.appUrl },
    flags: flags ? Object.fromEntries(Object.entries(flags).filter(([k]) => k.startsWith("mobile."))) : null,
    versionPolicy: { android, ios },
    devices: { android: byPlatform ? count(byPlatform, "ANDROID") : null, ios: byPlatform ? count(byPlatform, "IOS") : null, activeLast30Days: activeLast30, withPushToken: withPush, tokenInvalid: invalid },
    versions: versions?.map((v) => ({ platform: v.platform, version: v.appVersion, devices: v._count._all })) ?? null,
    push: {
      providers: { fcm: fcm.isConfigured(), apns: apns.isConfigured() },
      last24h: pushStatus ? Object.fromEntries(pushStatus.map((r) => [r.status, r._count._all])) : null,
      topReasons: pushReasons?.map((r) => ({ reason: r.reason ?? "none", count: r._count._all })) ?? null,
    },
    deepLinks: {
      appLinksConfigured: androidCertFingerprints().length > 0,
      universalLinksConfigured: appleTeamId() !== null,
      allowedRoutes: associatedPathPatterns().length,
      last24h: deepLinks ? Object.fromEntries(deepLinks.map((r) => [r.outcome ?? "none", r._count._all])) : null,
    },
    security: { last24h: events ? Object.fromEntries(events.map((r) => [r.eventType, r._count._all])) : null },
    errors,
    releases,
    analytics: { enabled: analyticsEnabled(), last7DaysByEvent: usage ? Object.fromEntries(usage.map((r) => [r.event, r._sum.count ?? 0])) : null },
    notes: [
      "Push tokens are stored encrypted and are never shown here.",
      "A store listing, signing key and push credentials are set up outside this system; the rows above only show whether the server has what it needs.",
    ],
  };
}

export async function adminDeviceSummaries(limit = 50) {
  // No account names, e-mail addresses or numbers: a device is shown by its own id, platform, version and recency only.
  return prisma.mobileDevice.findMany({ where: { status: "ACTIVE" }, orderBy: { lastSeenAt: "desc" }, take: Math.min(100, limit), select: { id: true, platform: true, appVersion: true, osVersion: true, ownerKind: true, lastSeenAt: true, createdAt: true, pushTokenEnc: true, biometricEnabled: true } }).then((rows) => rows.map(({ pushTokenEnc, ...r }) => ({ ...r, pushEnabled: !!pushTokenEnc })));
}

export function requireMobilePermission(admin: SessionAdmin, permission: "platform:mobile:view" | "platform:mobile:manage" | "platform:mobile:push") {
  if (!admin.permissions.includes(permission)) throw new ApiError(403, "Forbidden: insufficient permissions");
}