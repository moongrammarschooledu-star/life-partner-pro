import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/route-guard";
import { revokeProfileSession } from "@/lib/profile-session";
import { revokeFamilyMemberSession } from "@/lib/family/family-member-session";
import { writeAudit } from "@/lib/audit";
import { actorIds, ownerWhere, type MobileActor } from "@/lib/mobile/auth";
import { mobileEvent } from "@/lib/mobile/security-events";
import { decryptPushToken, encryptPushToken, hashPushToken } from "@/lib/mobile/token-crypto";
import { isValidVersion } from "@/lib/mobile/version";
import { providerForPlatform } from "@/lib/mobile/push/registry";
import { isDisplayMode } from "@/lib/mobile/push/payload";

// Registered devices (STEP 37 §11). One installed app = one row, owned by whoever is signed in on it. Everything here works on the caller's OWN devices only:
// an id that belongs to someone else behaves exactly like one that does not exist.

export const MAX_ACTIVE_DEVICES = 10;
const CONTROL = /[\u0000-\u001f\u007f<>]/g;

export const registerDeviceSchema = z.object({
  installationId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  platform: z.enum(["ANDROID", "IOS"]),
  appVersion: z.string().refine(isValidVersion, "Invalid version"),
  osVersion: z.string().max(32).regex(/^[\w .()-]*$/).optional(),
  deviceLabel: z.string().max(120).optional(),
});

export type DeviceView = {
  id: string;
  platform: "ANDROID" | "IOS";
  deviceLabel: string | null;
  appVersion: string;
  osVersion: string | null;
  lastSeenAt: Date;
  createdAt: Date;
  isCurrent: boolean;
  pushEnabled: boolean;
  displayMode: string | null;
  biometricEnabled: boolean;
};

const label = (v: string | undefined) => (v ? v.replace(CONTROL, "").trim().slice(0, 80) || null : null);

function view(d: { id: string; installationId: string; platform: "ANDROID" | "IOS"; deviceLabel: string | null; appVersion: string; osVersion: string | null; lastSeenAt: Date; createdAt: Date; pushTokenEnc: string | null; displayMode: string | null; biometricEnabled: boolean }, currentInstallation?: string): DeviceView {
  // The push token itself is never part of a view: only whether one is registered.
  return { id: d.id, platform: d.platform, deviceLabel: d.deviceLabel, appVersion: d.appVersion, osVersion: d.osVersion, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt, isCurrent: !!currentInstallation && d.installationId === currentInstallation, pushEnabled: !!d.pushTokenEnc, displayMode: d.displayMode, biometricEnabled: d.biometricEnabled };
}

const SELECT = { id: true, installationId: true, platform: true, deviceLabel: true, appVersion: true, osVersion: true, lastSeenAt: true, createdAt: true, pushTokenEnc: true, displayMode: true, biometricEnabled: true } as const;

export async function registerDevice(actor: MobileActor, raw: unknown) {
  const input = registerDeviceSchema.safeParse(raw);
  if (!input.success) throw new ApiError(400, "That device registration is not valid.");
  const d = input.data;
  const existing = await prisma.mobileDevice.findUnique({ where: { installationId: d.installationId } });

  if (existing && existing.platform !== d.platform) throw new ApiError(409, "This installation cannot be registered.");

  const sameOwner = !!existing && (actor.kind === "PROFILE" ? existing.profileId === actor.profileId : existing.familyMemberId === actor.familyMemberId);
  if (!existing || existing.status !== "ACTIVE" || !sameOwner) {
    const active = await prisma.mobileDevice.count({ where: { ...ownerWhere(actor), status: "ACTIVE" } });
    if (active >= MAX_ACTIVE_DEVICES) throw new ApiError(409, `At most ${MAX_ACTIVE_DEVICES} devices can be signed in. Remove one you no longer use.`);
  }

  const data = {
    platform: d.platform,
    ownerKind: actor.kind,
    ...actorIds(actor),
    sessionId: actor.sessionId,
    appVersion: d.appVersion,
    osVersion: d.osVersion ?? null,
    deviceLabel: label(d.deviceLabel),
    status: "ACTIVE" as const,
    lastSeenAt: new Date(),
    removedAt: null,
  };

  if (!existing) {
    const row = await prisma.mobileDevice.create({ data: { installationId: d.installationId, ...data }, select: SELECT });
    await mobileEvent("MOBILE_DEVICE_REGISTERED", actor, { platform: d.platform, appVersion: d.appVersion });
    await mobileEvent("MOBILE_SESSION_CREATED", actor, { platform: d.platform });
    return view(row, d.installationId);
  }

  // The install changed hands (someone else signed in on it) or came back after removal: the old push token and biometric choice do not carry over.
  const changedHands = !sameOwner || existing.status !== "ACTIVE";
  const row = await prisma.mobileDevice.update({
    where: { id: existing.id },
    data: { ...data, ...(changedHands ? { pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null, biometricEnabled: false, displayMode: null } : {}) },
    select: SELECT,
  });
  if (changedHands) {
    await mobileEvent("MOBILE_SESSION_CREATED", actor, { platform: d.platform, reason: sameOwner ? "returned" : "new_owner" });
    if (!sameOwner) await mobileEvent("MOBILE_SECURITY_WARNING", null, { reason: "installation_changed_owner", platform: d.platform });
  }
  if (existing.appVersion !== d.appVersion) await mobileEvent("MOBILE_APP_UPDATED", actor, { from: existing.appVersion, to: d.appVersion, platform: d.platform });
  return view(row, d.installationId);
}

export async function listDevices(actor: MobileActor, currentInstallation?: string): Promise<DeviceView[]> {
  const rows = await prisma.mobileDevice.findMany({ where: { ...ownerWhere(actor), status: "ACTIVE" }, orderBy: { lastSeenAt: "desc" }, take: 50, select: SELECT });
  return rows.map((r) => view(r, currentInstallation));
}

async function ownDevice(actor: MobileActor, id: string) {
  const row = await prisma.mobileDevice.findFirst({ where: { id, ...ownerWhere(actor), status: { not: "REMOVED" } } });
  if (!row) throw new ApiError(404, "Not found.");
  return row;
}

/** Signs this device out: the device is removed, its push token is deleted, and the session it used is revoked. */
export async function removeDevice(actor: MobileActor, id: string) {
  const row = await ownDevice(actor, id);
  await prisma.mobileDevice.update({ where: { id: row.id }, data: { status: "REMOVED", removedAt: new Date(), pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null, biometricEnabled: false } });
  if (row.sessionId) {
    if (actor.kind === "PROFILE") await revokeProfileSession(row.sessionId, actor.profileId).catch(() => {});
    else await revokeFamilyMemberSession(row.sessionId, actor.familyMemberId).catch(() => {});
    await mobileEvent("MOBILE_SESSION_REVOKED", actor, { platform: row.platform, reason: "device_removed" });
  }
  await mobileEvent("MOBILE_DEVICE_REMOVED", actor, { platform: row.platform });
  return { removed: true, endedCurrentSession: row.sessionId === actor.sessionId };
}

export const pushTokenSchema = z.object({
  installationId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  token: z.string().min(20).max(4096),
});

export async function registerPushToken(actor: MobileActor, raw: unknown) {
  const input = pushTokenSchema.safeParse(raw);
  if (!input.success) throw new ApiError(400, "That push registration is not valid.");
  const device = await prisma.mobileDevice.findFirst({ where: { installationId: input.data.installationId, ...ownerWhere(actor), status: { not: "REMOVED" } } });
  if (!device) throw new ApiError(404, "Not found.");

  const provider = providerForPlatform(device.platform);
  if (!provider.validateToken(input.data.token)) throw new ApiError(400, "That push token is not valid for this device.");

  const hash = hashPushToken(input.data.token);
  // A token belongs to exactly one installation. If it shows up on another one (an app restored from a backup, a resold phone), the older claim is cleared.
  const claimed = await prisma.mobileDevice.updateMany({ where: { pushTokenHash: hash, id: { not: device.id } }, data: { pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null } });
  const changed = device.pushTokenHash !== hash;
  await prisma.mobileDevice.update({
    where: { id: device.id },
    data: { pushTokenEnc: encryptPushToken(input.data.token), pushTokenHash: hash, pushProvider: provider.id, pushTokenAt: new Date(), status: "ACTIVE", lastSeenAt: new Date() },
  });
  if (changed) await mobileEvent("MOBILE_PUSH_TOKEN_CHANGED", actor, { platform: device.platform, provider: provider.id, movedFromOther: claimed.count > 0 });
  return { registered: true };
}

export async function unregisterPushToken(actor: MobileActor, installationId: unknown) {
  if (typeof installationId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(installationId)) throw new ApiError(400, "That push registration is not valid.");
  const device = await prisma.mobileDevice.findFirst({ where: { installationId, ...ownerWhere(actor), status: { not: "REMOVED" } } });
  if (!device) throw new ApiError(404, "Not found.");
  await prisma.mobileDevice.update({ where: { id: device.id }, data: { pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null } });
  return { unregistered: true };
}

export async function updateDeviceSettings(actor: MobileActor, id: string, body: { displayMode?: unknown; biometricEnabled?: unknown }) {
  const device = await ownDevice(actor, id);
  const data: { displayMode?: string | null; biometricEnabled?: boolean } = {};
  if (body.displayMode !== undefined) {
    if (body.displayMode !== null && !isDisplayMode(body.displayMode)) throw new ApiError(400, "Unknown notification display mode.");
    data.displayMode = body.displayMode as string | null;
  }
  if (body.biometricEnabled !== undefined) {
    if (typeof body.biometricEnabled !== "boolean") throw new ApiError(400, "biometricEnabled must be true or false.");
    data.biometricEnabled = body.biometricEnabled;
  }
  if (Object.keys(data).length === 0) throw new ApiError(400, "Nothing to change.");
  const row = await prisma.mobileDevice.update({ where: { id: device.id }, data, select: SELECT });
  if (data.biometricEnabled !== undefined && data.biometricEnabled !== device.biometricEnabled) await mobileEvent(data.biometricEnabled ? "MOBILE_BIOMETRIC_ENABLED" : "MOBILE_BIOMETRIC_DISABLED", actor, { platform: device.platform });
  return view(row);
}

/** Admin removal (a lost device reported to support). Audited; the owner's session is revoked as for a self-service removal. */
export async function adminRemoveDevice(adminId: string, id: string, reason: string) {
  const row = await prisma.mobileDevice.findFirst({ where: { id, status: { not: "REMOVED" } } });
  if (!row) throw new ApiError(404, "Not found.");
  await prisma.mobileDevice.update({ where: { id }, data: { status: "REMOVED", removedAt: new Date(), pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null, biometricEnabled: false } });
  if (row.sessionId) {
    if (row.profileId) await revokeProfileSession(row.sessionId, row.profileId).catch(() => {});
    else if (row.familyMemberId) await revokeFamilyMemberSession(row.sessionId, row.familyMemberId).catch(() => {});
  }
  await writeAudit({ action: "MOBILE_DEVICE_REMOVED_BY_ADMIN", adminId, meta: { deviceId: id, platform: row.platform, reason } });
}

/** Called by the push sender when a provider says the token is dead. */
export async function markTokenInvalid(deviceId: string) {
  await prisma.mobileDevice.update({ where: { id: deviceId }, data: { status: "TOKEN_INVALID", pushTokenEnc: null, pushTokenHash: null, pushProvider: null, pushTokenAt: null } }).catch(() => {});
}

/** Decrypts a device's token for sending. Returns null when none is stored or it cannot be read. */
export function tokenOf(device: { pushTokenEnc: string | null }): string | null {
  return device.pushTokenEnc ? decryptPushToken(device.pushTokenEnc) : null;
}