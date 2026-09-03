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
  | "note:add"
  | "communication:add"
  | "audit:view"
  | "settings:edit"
  | "admin:manage";

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
    "note:add",
    "communication:add",
    "audit:view",
    "settings:edit",
    "admin:manage",
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
  ],
  STAFF: [
    "profile:view",
    "profile:edit",
    "profile:status",
    "match:run",
    "proposal:create",
    "note:add",
    "communication:add",
  ],
  VIEWER: ["profile:view", "audit:view"],
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
