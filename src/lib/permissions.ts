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
  | "verification:duplicate:scan"
  | "communication:view"
  | "communication:send"
  | "communication:message:view"
  | "notification:template:manage"
  | "reports:view"
  | "reports:export"
  | "reports:income:view"
  | "reports:staff-performance:view"
  | "reports:schedule:manage"
  // ---------- Staff Management & Permissions (STEP 11) ----------
  | "sensitive:income:view"
  | "sensitive:notes:view"
  | "sensitive:family:view"
  | "staff:view"
  | "profile:assign"
  | "verification:assign"
  // ---------- Support, Complaints, Safety & Case Management (STEP 12) ----------
  | "support:view"
  | "support:create"
  | "support:edit"
  | "support:assign"
  | "support:manage"
  | "support:resolve"
  | "support:close"
  | "cases:view"
  | "cases:create"
  | "cases:edit"
  | "cases:assign"
  | "cases:manage"
  | "cases:escalate"
  | "cases:escalate:senior"
  | "cases:staff-conduct:view"
  | "cases:resolve"
  | "cases:close"
  | "cases:reopen"
  | "cases:merge"
  | "complaints:view"
  | "complaints:create"
  | "complaints:review"
  | "complaints:resolve"
  | "safety_cases:view"
  | "safety_cases:review"
  | "safety_cases:escalate"
  | "safety_cases:resolve"
  | "sensitive:case:evidence:view"
  | "sensitive:case:notes:view"
  | "sensitive:case:restricted-profile:view"
  | "profile:restrict"
  | "profile:suspend"
  // ---------- Data Privacy, Consent, Account Management & Retention (STEP 13) ----------
  | "privacy:view"
  | "privacy:manage"
  | "privacy:consent:view"
  | "privacy:consent:manage"
  | "privacy:requests:view"
  | "privacy:requests:manage"
  | "privacy:export:view"
  | "privacy:export:create"
  | "privacy:delete:manage"
  | "privacy:retention:view"
  | "privacy:retention:manage"
  | "privacy:hold:view"
  | "privacy:hold:manage"
  | "privacy:incidents:view"
  | "privacy:incidents:manage"
  | "privacy:break-glass:manage"
  | "contact:reveal:override"
  | "sensitive:photos:view"
  | "privacy_incidents:view"
  | "privacy_incidents:review"
  | "privacy_incidents:resolve"
  // ---------- Payment, Subscription, Packages & Financial Management (STEP 14) ----------
  | "finance:view"
  | "finance:dashboard:view"
  | "finance:payments:view"
  | "finance:payments:manage"
  | "finance:invoices:view"
  | "finance:invoices:manage"
  | "finance:refunds:view"
  | "finance:refunds:request"
  | "finance:refunds:approve"
  | "finance:subscriptions:view"
  | "finance:subscriptions:manage"
  | "finance:packages:view"
  | "finance:packages:manage"
  | "finance:coupons:view"
  | "finance:coupons:manage"
  | "finance:reconciliation:view"
  | "finance:reconciliation:manage"
  | "finance:reports:view"
  | "finance:reports:export"
  | "finance:rollout:view"
  | "finance:rollout:manage"
  | "finance:rollout:enable"
  | "finance:rollout:disable"
  | "finance:provider:manage"
  | "finance:webhooks:view"
  | "sensitive:finance:view"
  | "sensitive:finance:export"
  | "system:view"
  | "system:config:manage"
  | "system:flags:manage"
  | "system:maintenance:manage"
  | "system:emergency:manage"
  | "system:backup:view"
  | "system:backup:trigger"
  | "system:restore:approve"
  | "system:jobs:view"
  | "system:jobs:manage"
  | "alerts:view"
  | "alerts:manage"
  | "readiness:view"
  | "releases:manage"
  | "ai:view"
  | "ai:use"
  | "ai:copilot"
  | "ai:communication:draft"
  | "ai:report:use"
  | "ai:config:manage"
  | "ai:rollout:manage"
  | "ai:killswitch"
  | "ai:activity:view"
  | "ai:usage:view"
  | "ai:test:run";

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
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
    "communication:view",
    "communication:send",
    "communication:message:view",
    "notification:template:manage",
    "reports:view",
    "reports:export",
    "reports:income:view",
    "reports:staff-performance:view",
    "reports:schedule:manage",
    "sensitive:income:view",
    "sensitive:notes:view",
    "sensitive:family:view",
    "staff:view",
    "profile:assign",
    "verification:assign",
    "support:view",
    "support:create",
    "support:edit",
    "support:assign",
    "support:manage",
    "support:resolve",
    "support:close",
    "cases:view",
    "cases:create",
    "cases:edit",
    "cases:assign",
    "cases:manage",
    "cases:escalate",
    "cases:escalate:senior",
    "cases:staff-conduct:view",
    "cases:resolve",
    "cases:close",
    "cases:reopen",
    "cases:merge",
    "complaints:view",
    "complaints:create",
    "complaints:review",
    "complaints:resolve",
    "safety_cases:view",
    "safety_cases:review",
    "safety_cases:escalate",
    "safety_cases:resolve",
    "sensitive:case:evidence:view",
    "sensitive:case:notes:view",
    "sensitive:case:restricted-profile:view",
    "profile:restrict",
    "profile:suspend",
    "privacy:view",
    "privacy:manage",
    "privacy:consent:view",
    "privacy:consent:manage",
    "privacy:requests:view",
    "privacy:requests:manage",
    "privacy:export:view",
    "privacy:export:create",
    "privacy:delete:manage",
    "privacy:retention:view",
    "privacy:retention:manage",
    "privacy:hold:view",
    "privacy:hold:manage",
    "privacy:incidents:view",
    "privacy:incidents:manage",
    "privacy:break-glass:manage",
    "contact:reveal:override",
    "sensitive:photos:view",
    "privacy_incidents:view",
    "privacy_incidents:review",
    "privacy_incidents:resolve",
    "finance:view",
    "finance:dashboard:view",
    "finance:payments:view",
    "finance:payments:manage",
    "finance:invoices:view",
    "finance:invoices:manage",
    "finance:refunds:view",
    "finance:refunds:request",
    "finance:refunds:approve",
    "finance:subscriptions:view",
    "finance:subscriptions:manage",
    "finance:packages:view",
    "finance:packages:manage",
    "finance:coupons:view",
    "finance:coupons:manage",
    "finance:reconciliation:view",
    "finance:reconciliation:manage",
    "finance:reports:view",
    "finance:reports:export",
    "finance:rollout:view",
    "finance:rollout:manage",
    "finance:rollout:enable",
    "finance:rollout:disable",
    "finance:provider:manage",
    "finance:webhooks:view",
    "system:view",
    "system:config:manage",
    "system:flags:manage",
    "system:maintenance:manage",
    "system:emergency:manage",
    "system:backup:view",
    "system:backup:trigger",
    "system:restore:approve",
    "system:jobs:view",
    "system:jobs:manage",
    "alerts:view",
    "alerts:manage",
    "readiness:view",
    "releases:manage",
    "ai:view",
    "ai:use",
    "ai:copilot",
    "ai:communication:draft",
    "ai:report:use",
    "ai:config:manage",
    "ai:rollout:manage",
    "ai:killswitch",
    "ai:activity:view",
    "ai:usage:view",
    "ai:test:run",
    "sensitive:finance:view",
    "sensitive:finance:export",
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
    "communication:view",
    "communication:send",
    "communication:message:view",
    "notification:template:manage",
    "reports:view",
    "reports:export",
    "reports:income:view",
    "sensitive:income:view",
    "sensitive:notes:view",
    "sensitive:family:view",
    "staff:view",
    "profile:assign",
    "verification:assign",
    "support:view",
    "support:create",
    "support:edit",
    "support:assign",
    "support:manage",
    "support:resolve",
    "support:close",
    "cases:view",
    "cases:create",
    "cases:edit",
    "cases:assign",
    "cases:manage",
    "cases:escalate",
    "cases:escalate:senior",
    "cases:resolve",
    "cases:close",
    "cases:reopen",
    "complaints:view",
    "complaints:create",
    "complaints:review",
    "complaints:resolve",
    "safety_cases:view",
    "safety_cases:review",
    "safety_cases:escalate",
    "safety_cases:resolve",
    "sensitive:case:evidence:view",
    "sensitive:case:notes:view",
    "sensitive:case:restricted-profile:view",
    "profile:restrict",
    "profile:suspend",
    // ADMIN deliberately lacks cases:merge and cases:staff-conduct:view —
    // SUPER_ADMIN only, per the STEP 12 plan's conflict-of-interest design.
    "privacy:view",
    "privacy:manage",
    "privacy:consent:view",
    "privacy:consent:manage",
    "privacy:requests:view",
    "privacy:requests:manage",
    "privacy:export:view",
    "privacy:export:create",
    "privacy:retention:view",
    "privacy:retention:manage",
    "privacy:hold:view",
    "privacy:hold:manage",
    "privacy:incidents:view",
    "privacy:incidents:manage",
    "contact:reveal:override",
    "sensitive:photos:view",
    "privacy_incidents:view",
    "privacy_incidents:review",
    "privacy_incidents:resolve",
    // ADMIN deliberately lacks privacy:delete:manage and
    // privacy:break-glass:manage — SUPER_ADMIN only, per STEP 13's plan.
    "finance:view",
    "finance:dashboard:view",
    "finance:payments:view",
    "finance:payments:manage",
    "finance:invoices:view",
    "finance:invoices:manage",
    "finance:refunds:view",
    "finance:refunds:request",
    "finance:refunds:approve",
    "finance:subscriptions:view",
    "finance:subscriptions:manage",
    "finance:packages:view",
    "finance:packages:manage",
    "finance:coupons:view",
    "finance:coupons:manage",
    "finance:reconciliation:view",
    "finance:reports:view",
    "finance:reports:export",
    "sensitive:finance:view",
    "sensitive:finance:export",
    // ADMIN deliberately lacks finance:reconciliation:manage — SUPER_ADMIN
    // only, per STEP 14's plan (full financial control stays top-tier).
    "finance:rollout:view",
    "finance:webhooks:view",
    "system:view",
    "system:jobs:view",
    "system:backup:view",
    "alerts:view",
    "alerts:manage",
    "readiness:view",
    "ai:view",
    "ai:use",
    "ai:copilot",
    "ai:communication:draft",
    "ai:report:use",
    // ADMIN deliberately lacks ai:config/rollout/killswitch/activity/usage/test — SUPER_ADMIN only (STEP 16).
    // ADMIN deliberately lacks system:config/flags/maintenance/emergency/backup:trigger/restore/jobs:manage/releases —
    // SUPER_ADMIN only (STEP 15). ADMIN can observe and work alerts, nothing more.
    // ADMIN deliberately lacks finance:rollout:manage/enable/disable and
    // finance:provider:manage — changing rollout stage (especially the kill
    // switch and any move into PRODUCTION) stays SUPER_ADMIN-only with
    // reauth, per this add-on's plan.
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
    "communication:view",
    "communication:send", // row-gated: only proposals/profiles assigned to them — see src/lib/communication-access.ts
    "reports:view",
    "reports:export",
    "sensitive:family:view", // Family Coordination department staff need this; income/notes stay restricted
    "support:view",
    "support:create",
    "cases:view",
    "cases:create",
    "cases:edit", // row-gated: only cases assigned to them — see src/lib/case-access.ts
    "cases:resolve", // row-gated the same way
    "cases:close", // row-gated the same way
    "complaints:view", // row-gated
    "safety_cases:view", // row-gated
    "sensitive:case:evidence:view", // still row-gated by case assignment — this only lifts the flat permission floor
    "privacy:consent:view", // row-gated: only profiles they're assigned to
    "privacy:requests:view", // row-gated the same way
    "privacy_incidents:view", // row-gated: only incidents assigned to them — see src/lib/case-access.ts
    "finance:payments:view", // row-gated: only profiles they're assigned to
    "finance:invoices:view", // row-gated the same way
    "finance:refunds:request", // never finance:refunds:approve — spec §23
    "ai:use", // row-gated: only profiles assigned to them — STEP 16 (src/lib/ai/authorize.ts)
  ],
  VIEWER: ["profile:view", "audit:view", "verification:view", "communication:view", "reports:view"],
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
