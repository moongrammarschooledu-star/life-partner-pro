export type AdminRole = "SUPER_ADMIN" | "ADMIN" | "STAFF" | "VIEWER";

export type Permission =
  | "profile:view"
  | "profile:edit"
  | "profile:delete"
  | "profile:verify"
  | "profile:status"
  | "contact:reveal"
  | "match:run"
  | "proposal:create"
  | "proposal:edit"
  | "proposal:assign"
  | "note:add"
  | "communication:add"
  | "audit:view"
  | "settings:edit"
  | "admin:manage"
  | "verification:view"
  | "verification:review"
  | "verification:document:view"
  | "verification:flag:manage"
  | "verification:duplicate:scan";

const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  SUPER_ADMIN: [
    "profile:view",
    "profile:edit",
    "profile:delete",
    "profile:verify",
    "profile:status",
    "contact:reveal",
    "match:run",
    "proposal:create",
    "proposal:edit",
    "proposal:assign",
    "note:add",
    "communication:add",
    "audit:view",
    "settings:edit",
    "admin:manage",
    "verification:view",
    "verification:review",
    "verification:document:view",
    "verification:flag:manage",
    "verification:duplicate:scan",
  ],
  ADMIN: [
    "profile:view",
    "profile:edit",
    "profile:delete",
    "profile:verify",
    "profile:status",
    "contact:reveal",
    "match:run",
    "proposal:create",
    "proposal:edit",
    "note:add",
    "communication:add",
    "audit:view",
    "verification:view",
    "verification:review",
    "verification:document:view",
    "verification:flag:manage",
    "verification:duplicate:scan",
  ],
  STAFF: [
    "profile:view",
    "profile:edit",
    "profile:status",
    "match:run",
    "proposal:create",
    "proposal:edit", // row-gated: only proposals assigned to them — see src/lib/proposal-access.ts
    "note:add",
    "communication:add",
    "verification:view",
    "verification:review", // row-gated: only verifications assigned to them — see src/lib/verification-access.ts
    "verification:flag:manage", // row-gated the same way
  ],
  VIEWER: ["profile:view", "audit:view", "verification:view"],
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function assertPermission(role: AdminRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new PermissionError(permission);
  }
}

export class PermissionError extends Error {
  constructor(permission: Permission) {
    super(`Role does not have permission: ${permission}`);
    this.name = "PermissionError";
  }
}
