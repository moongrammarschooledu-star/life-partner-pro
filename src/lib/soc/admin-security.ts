import type { AuditAction } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveEffectivePermissions } from "@/lib/effective-permissions";
import { getSessionPolicy } from "@/lib/soc/session-policy";
import type { AdminRole } from "@/lib/permissions";

// STEP 32 — administrator security: who is protected by a second factor, which sessions are live, who changed privileges, who used break-glass.
// Read models over tables that already exist; nothing here changes an account. A PRIVILEGED administrator is anyone who can do something that
// is hard to undo or that widens other people's access.

export const PRIVILEGED_PERMISSIONS = [
  "admin:manage", "system:config:manage", "system:emergency:manage", "system:restore:approve", "system:flags:manage", "soc:containment:approve", "soc:config:manage",
  "sensitive:finance:export", "risk:suspend", "analytics:sensitive:view",
] as const;

export function isPrivileged(permissions: readonly string[]): boolean {
  return PRIVILEGED_PERMISSIONS.some((p) => permissions.includes(p));
}

// The sign-in flow asks for the one-time code when the person turned two-factor on, when their role is on the existing "required roles" list,
// or — if the owner switches it on in the security configuration — when they are privileged. Fails open (false) if the setting is unreadable.
export async function mfaEnforcedFor(admin: { role: string; customRoleId: string | null }): Promise<boolean> {
  try {
    const policy = await getSessionPolicy();
    if (!policy.enforceMfa) return false;
    return isPrivileged(await resolveEffectivePermissions({ role: admin.role as AdminRole, customRoleId: admin.customRoleId ?? null }));
  } catch {
    return false;
  }
}

export interface MfaGap { adminId: string; name: string; role: string; reason: string }
export interface MfaCoverage {
  privilegedTotal: number;
  covered: number;
  gaps: MfaGap[];
  policy: { enforceMfaPrivileged: boolean; requiredRoles: string[] };
  note: string;
}

export async function mfaCoverage(): Promise<MfaCoverage> {
  const [admins, app, policy] = await Promise.all([
    prisma.adminUser.findMany({ where: { active: true }, select: { id: true, name: true, role: true, customRoleId: true, twoFactorEnabled: true }, take: 500 }),
    prisma.appSettings.findUnique({ where: { id: 1 }, select: { twoFactorRequiredRoles: true } }),
    getSessionPolicy(),
  ]);
  const required = Array.isArray(app?.twoFactorRequiredRoles) ? (app!.twoFactorRequiredRoles as string[]) : [];
  const gaps: MfaGap[] = [];
  let privilegedTotal = 0;
  for (const a of admins) {
    const perms = await resolveEffectivePermissions({ role: a.role as AdminRole, customRoleId: a.customRoleId ?? null });
    if (!isPrivileged(perms)) continue;
    privilegedTotal++;
    const covered = a.twoFactorEnabled || required.includes(a.role) || policy.enforceMfa;
    if (!covered) gaps.push({ adminId: a.id, name: a.name, role: a.role, reason: "No second step is required when this person signs in." });
  }
  return {
    privilegedTotal,
    covered: privilegedTotal - gaps.length,
    gaps,
    policy: { enforceMfaPrivileged: policy.enforceMfa, requiredRoles: required },
    note: "A privileged administrator is covered when they enabled two-factor, their role is on the required list, or enforcement for privileged roles is switched on.",
  };
}

// Mask the last part of an address: enough to tell two sessions apart, not enough to locate a person.
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":…";
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.…` : "…";
}

export async function activeAdminSessions(limit = 200) {
  const rows = await prisma.adminSession.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActiveAt: "desc" }, take: Math.min(limit, 300), include: { admin: { select: { name: true, role: true } } } });
  return rows.map((s) => ({ id: s.id, adminId: s.adminId, adminName: s.admin?.name ?? "—", role: s.admin?.role ?? "—", device: s.deviceInfo, ip: maskIp(s.ipAddress), lastActiveAt: s.lastActiveAt, createdAt: s.createdAt, expiresAt: s.expiresAt }));
}

const PRIVILEGE_ACTIONS: AuditAction[] = ["ADMIN_USER_CREATED", "ADMIN_USER_ROLE_CHANGED", "CUSTOM_ROLE_PERMISSIONS_CHANGED", "ADMIN_ROLE_ASSIGNED", "ADMIN_ROLE_REMOVED", "ADMIN_PERMISSION_GRANTED", "ADMIN_PERMISSION_REVOKED", "ADMIN_SENSITIVE_PERMISSION_GRANTED", "ADMIN_SENSITIVE_PERMISSION_REVOKED", "BREAK_GLASS_GRANTED", "BREAK_GLASS_USED"];

function targetOf(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const m = JSON.parse(meta) as Record<string, unknown>;
    const t = m.targetAdminId ?? m.adminId ?? m.userId ?? m.roleId;
    return typeof t === "string" ? t.slice(0, 40) : null;
  } catch {
    return null;
  }
}

export async function privilegeChanges(days = 30, limit = 200) {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
  const rows = await prisma.auditLog.findMany({ where: { action: { in: PRIVILEGE_ACTIONS }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 500), select: { id: true, action: true, adminId: true, createdAt: true, meta: true } });
  return rows.map((r) => ({ id: r.id, action: r.action, actorId: r.adminId, targetId: targetOf(r.meta), at: r.createdAt }));
}

export async function breakGlassUsage(days = 90, limit = 100) {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
  const rows = await prisma.breakGlassAccess.findMany({ where: { grantedAt: { gte: since } }, orderBy: { grantedAt: "desc" }, take: Math.min(limit, 300) });
  return rows.map((r) => ({ id: r.id, adminId: r.adminId, recordType: r.recordType, grantedAt: r.grantedAt, expiresAt: r.expiresAt, used: !!r.usedAt, usedAt: r.usedAt, reason: r.reason }));
}

export async function loginSignals(days = 7) {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 90) * 86_400_000);
  const [success, failure, locked] = await Promise.all(
    (["SUCCESS", "FAILURE", "LOCKED"] as const).map((event) => prisma.adminLoginHistory.count({ where: { event, createdAt: { gte: since } } })),
  );
  return { days, success, failure, locked, note: "Counts of sign-in attempts to administrator accounts in the period." };
}
