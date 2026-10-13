import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { currentEnvironment } from "@/lib/platform/environment";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";
import { recordConfigChange } from "@/lib/platform/config-change";
import { DEFAULT_POLICY, evaluateVersion, policyProblem, safeStoreUrl, type UpdateStatus, type VersionPolicy } from "@/lib/mobile/version";

type Platform = "ANDROID" | "IOS";

export async function getVersionPolicy(platform: Platform): Promise<VersionPolicy & { storeUrl: string | null; version: number }> {
  const row = await prisma.mobileVersionPolicy.findUnique({ where: { platform } }).catch(() => null);
  if (!row) return { ...DEFAULT_POLICY, storeUrl: null, version: 0 };
  return { minimumSupportedVersion: row.minimumSupportedVersion, recommendedVersion: row.recommendedVersion, latestVersion: row.latestVersion, storeUrl: safeStoreUrl(row.storeUrl), version: row.version };
}

/** The public answer to "is this app version still allowed?". The store address is only ever an official store listing. */
export async function versionAnswer(platform: Platform, clientVersion: unknown): Promise<{ platform: Platform; minimumSupportedVersion: string; recommendedVersion: string; latestVersion: string; status: UpdateStatus; storeUrl: string | null; message: string | null }> {
  const p = await getVersionPolicy(platform);
  const status = evaluateVersion(clientVersion, p);
  return {
    platform,
    minimumSupportedVersion: p.minimumSupportedVersion,
    recommendedVersion: p.recommendedVersion,
    latestVersion: p.latestVersion,
    status,
    storeUrl: p.storeUrl,
    message: status === "UPDATE_REQUIRED" ? "Please update Life Partner Pro to continue." : status === "UPDATE_RECOMMENDED" ? "A newer version of Life Partner Pro is available." : null,
  };
}

export async function setVersionPolicy(admin: SessionAdmin, input: { platform: unknown; minimumSupportedVersion: unknown; recommendedVersion: unknown; latestVersion: unknown; storeUrl?: unknown; reason: unknown; environment: unknown }) {
  if (!admin.permissions.includes("platform:mobile:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  if (input.platform !== "ANDROID" && input.platform !== "IOS") throw new ApiError(400, "Unknown platform.");
  const next = { minimumSupportedVersion: input.minimumSupportedVersion, recommendedVersion: input.recommendedVersion, latestVersion: input.latestVersion } as VersionPolicy;
  const problem = policyProblem(next);
  if (problem) throw new ApiError(400, problem);
  let storeUrl: string | null = null;
  if (input.storeUrl !== undefined && input.storeUrl !== null && input.storeUrl !== "") {
    storeUrl = safeStoreUrl(input.storeUrl);
    if (!storeUrl) throw new ApiError(400, "The update address must be the app's official Google Play or App Store page (https).");
  }
  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, what: { kind: "MOBILE_VERSION", key: input.platform } });
  const before = await getVersionPolicy(input.platform);
  const row = await prisma.mobileVersionPolicy.upsert({
    where: { platform: input.platform },
    update: { ...next, storeUrl, version: before.version + 1, updatedById: admin.id },
    create: { platform: input.platform, ...next, storeUrl, version: 1, updatedById: admin.id },
  });
  await recordConfigChange({ kind: "MOBILE_VERSION", key: input.platform, before: { min: before.minimumSupportedVersion, recommended: before.recommendedVersion, latest: before.latestVersion }, after: { min: next.minimumSupportedVersion, recommended: next.recommendedVersion, latest: next.latestVersion }, actor: admin, reason: ctx.reason, environment: currentEnvironment() });
  await writeAudit({ action: "MOBILE_VERSION_POLICY_CHANGED", adminId: admin.id, meta: { platform: input.platform, minimum: next.minimumSupportedVersion, recommended: next.recommendedVersion, latest: next.latestVersion, reason: ctx.reason } });
  return { platform: row.platform, version: row.version };
}