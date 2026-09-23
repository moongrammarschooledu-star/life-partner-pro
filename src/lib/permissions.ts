// STEP 17 — Exact Admin Roles & Granular Permission Matrix.
//
// The 4 original roles (SUPER_ADMIN/ADMIN/STAFF/VIEWER) are kept in this
// union — Postgres enum values are never safely dropped, and existing
// CustomRole.baseRole rows and any not-yet-migrated AdminUser row can still
// legitimately hold "ADMIN"/"STAFF". They are LEGACY: no admin is assigned
// either after the STEP 17 data migration (ADMIN -> OPERATIONS_ADMIN,
// STAFF -> STAFF_MATCHMAKER). `ADMIN_ROLES` below is the canonical,
// assignable-today list used by every UI dropdown and API validation — it
// deliberately excludes the two legacy labels.
export type AdminRole =
  | "SUPER_ADMIN"
  | "ADMIN" // legacy — retired, see comment above
  | "STAFF" // legacy — retired, see comment above
  | "VIEWER"
  | "OPERATIONS_ADMIN"
  | "MATCHMAKING_MANAGER"
  | "VERIFICATION_MANAGER"
  | "SUPPORT_MANAGER"
  | "COMMUNICATION_MANAGER"
  | "FINANCE_MANAGER"
  | "STAFF_MATCHMAKER"
  | "VERIFICATION_STAFF"
  | "SUPPORT_STAFF"
  | "COMMUNICATION_STAFF"
  | "REPORTING_ANALYST";

// The single source of truth for "which roles can be assigned to an admin
// today" — replaces the 3 other hardcoded 4-role lists this codebase used to
// carry independently (admin-users PATCH route's VALID_ROLES, the admin-users
// page's ROLES, and custom-roles' baseRole check).
export const ADMIN_ROLES: AdminRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "MATCHMAKING_MANAGER",
  "VERIFICATION_MANAGER",
  "SUPPORT_MANAGER",
  "COMMUNICATION_MANAGER",
  "FINANCE_MANAGER",
  "STAFF_MATCHMAKER",
  "VERIFICATION_STAFF",
  "SUPPORT_STAFF",
  "COMMUNICATION_STAFF",
  "REPORTING_ANALYST",
  "VIEWER",
];

export type Permission =
  | "profile:view"
  | "profile:edit"
  | "profile:delete"
  | "profile:verify"
  | "profile:status"
  | "profile:archive"
  | "profile:restore"
  | "contact:reveal"
  | "match:run"
  | "match:configure"
  | "proposal:create"
  | "proposal:edit"
  | "proposal:assign"
  | "proposal:finalize"
  | "proposal:archive"
  | "note:add"
  | "notes:view"
  | "notes:edit"
  | "notes:delete"
  | "communication:add"
  | "audit:view"
  | "settings:edit"
  | "admin:manage"
  | "verification:view"
  | "verification:review"
  | "verification:approve"
  | "verification:reject"
  | "verification:reverify"
  | "verification:request-info"
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
  | "profiles:export"
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
  | "sensitive:contact:view"
  | "sensitive:documents:view"
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
  // ---------- Production, DevOps, Monitoring & AI (STEP 15/16) ----------
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
  | "ai:test:run"
  // ---------- Exact Admin Roles & Granular Permission Matrix (STEP 17) ----------
  | "roles:view"
  | "roles:create"
  | "roles:edit"
  | "roles:disable"
  | "roles:assign"
  | "roles:delete"
  // ---------- Workflow & Task Management (STEP 18) ----------
  | "tasks:view"
  | "tasks:view:own"
  | "tasks:view:team"
  | "tasks:view:all"
  | "tasks:create"
  | "tasks:create:manual"
  | "tasks:assign"
  | "tasks:assign:any"
  | "tasks:reassign"
  | "tasks:accept"
  | "tasks:complete"
  | "tasks:reopen"
  | "tasks:cancel"
  | "tasks:escalate"
  | "tasks:escalate:senior"
  | "tasks:comment"
  | "tasks:comment:internal"
  | "tasks:attachments:upload"
  | "tasks:attachments:view"
  | "tasks:bulk-actions"
  | "tasks:templates:manage"
  | "tasks:sla:manage"
  | "tasks:automation:manage"
  | "tasks:workflow-failures:view"
  | "tasks:workflow-failures:resolve"
  | "tasks:reports:view"
  | "staff:availability:manage";

// STEP 17 §17 — the canonical list of sensitive permissions for the
// "Sensitive Permissions" UI, the Effective Permissions view and the
// Permission Matrix's "S" annotation. Never automatically implied by holding
// a manager/broad role; always granted (or not) independently per role below.
export const SENSITIVE_PERMISSIONS: Permission[] = [
  "sensitive:contact:view",
  "sensitive:income:view",
  "sensitive:family:view",
  "sensitive:documents:view",
  "sensitive:notes:view",
  "sensitive:case:evidence:view",
  "sensitive:case:notes:view",
  "sensitive:case:restricted-profile:view",
  "sensitive:photos:view",
  "sensitive:finance:view",
  "sensitive:finance:export",
];

// STEP 17 §2/§19 — replaces every literal `role === "STAFF"` row-scoping
// check in the codebase. `true` = this role's default access is NOT limited
// to assigned/shared records (a "manager"-tier role); `false` = "No
// Assignment = No Record Access" applies (spec §11/§19) unless a specific
// permission explicitly grants broader access. Legacy ADMIN/STAFF keep their
// historical shape (ADMIN was broad, STAFF was assignment-scoped) so any
// not-yet-migrated row behaves exactly as it always has.
const BROAD_ACCESS_ROLES = new Set<AdminRole>([
  "SUPER_ADMIN",
  "ADMIN",
  "OPERATIONS_ADMIN",
  "MATCHMAKING_MANAGER",
  "VERIFICATION_MANAGER",
  "SUPPORT_MANAGER",
  "COMMUNICATION_MANAGER",
  "FINANCE_MANAGER",
]);

export function hasBroadRecordAccess(role: AdminRole): boolean {
  return BROAD_ACCESS_ROLES.has(role);
}

// Narrower than "not broad": true only for the 4 assignment-scoped *_STAFF
// roles (plus legacy STAFF) that actually carry a personal assigned work
// queue. REPORTING_ANALYST/VIEWER are also non-broad but have no assigned
// work queue at all, so they get the full org-wide (read-only for them)
// dashboard/report views instead of an empty "my assignments" one.
const ASSIGNED_WORK_QUEUE_ROLES = new Set<AdminRole>(["STAFF", "STAFF_MATCHMAKER", "VERIFICATION_STAFF", "SUPPORT_STAFF", "COMMUNICATION_STAFF"]);

export function hasAssignedWorkQueue(role: AdminRole): boolean {
  return ASSIGNED_WORK_QUEUE_ROLES.has(role);
}

const CASE_PERMISSIONS: Permission[] = [
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
];

const PRIVACY_PERMISSIONS: Permission[] = [
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
  "sensitive:contact:view",
  "sensitive:documents:view",
  "sensitive:photos:view",
  "privacy_incidents:view",
  "privacy_incidents:review",
  "privacy_incidents:resolve",
];

const FINANCE_ALL_PERMISSIONS: Permission[] = [
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
  "sensitive:finance:view",
  "sensitive:finance:export",
];

const SYSTEM_ALL_PERMISSIONS: Permission[] = [
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
];

const AI_ALL_PERMISSIONS: Permission[] = [
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
];

const ROLES_ALL_PERMISSIONS: Permission[] = ["roles:view", "roles:create", "roles:edit", "roles:disable", "roles:assign", "roles:delete"];

// STEP 18 — the full task-management permission set; SUPER_ADMIN and
// OPERATIONS_ADMIN hold all of it, every other role gets a scoped subset
// (see each role's array below).
const TASKS_ALL_PERMISSIONS: Permission[] = [
  "tasks:view",
  "tasks:view:own",
  "tasks:view:team",
  "tasks:view:all",
  "tasks:create",
  "tasks:create:manual",
  "tasks:assign",
  "tasks:assign:any",
  "tasks:reassign",
  "tasks:accept",
  "tasks:complete",
  "tasks:reopen",
  "tasks:cancel",
  "tasks:escalate",
  "tasks:escalate:senior",
  "tasks:comment",
  "tasks:comment:internal",
  "tasks:attachments:upload",
  "tasks:attachments:view",
  "tasks:bulk-actions",
  "tasks:templates:manage",
  "tasks:sla:manage",
  "tasks:automation:manage",
  "tasks:workflow-failures:view",
  "tasks:workflow-failures:resolve",
  "tasks:reports:view",
  "staff:availability:manage",
];

// STEP 18 — each *_MANAGER role's task permissions: can view/manage their
// domain's team queue and escalate, but not the sensitive-tier escalation,
// system-config (templates/SLA/automation/workflow-failures), or cross-domain
// tasks:view:all/tasks:assign:any that only SUPER_ADMIN/OPERATIONS_ADMIN hold.
const MANAGER_TASK_PERMISSIONS: Permission[] = [
  "tasks:view",
  "tasks:view:own",
  "tasks:view:team",
  "tasks:create",
  "tasks:assign",
  "tasks:reassign",
  "tasks:accept",
  "tasks:complete",
  "tasks:reopen",
  "tasks:cancel",
  "tasks:escalate",
  "tasks:comment",
  "tasks:comment:internal",
  "tasks:attachments:upload",
  "tasks:attachments:view",
  "tasks:bulk-actions",
  "tasks:reports:view",
];

// STEP 18 — each *_STAFF role's task permissions: their own assigned work
// queue only — no create/assign/reassign/escalate/bulk-actions.
const STAFF_TASK_PERMISSIONS: Permission[] = ["tasks:view", "tasks:view:own", "tasks:accept", "tasks:complete", "tasks:comment", "tasks:attachments:upload", "tasks:attachments:view"];

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  // ---------------------------------------------------------------- SUPER_ADMIN (spec §4)
  SUPER_ADMIN: [
    "profile:view",
    "profile:edit",
    "profile:delete",
    "profile:verify",
    "profile:status",
    "profile:archive",
    "profile:restore",
    "contact:reveal",
    "match:run",
    "match:configure",
    "proposal:create",
    "proposal:edit",
    "proposal:assign",
    "proposal:finalize",
    "proposal:archive",
    "note:add",
    "notes:view",
    "notes:edit",
    "notes:delete",
    "communication:add",
    "audit:view",
    "settings:edit",
    "admin:manage",
    "verification:view",
    "verification:review",
    "verification:approve",
    "verification:reject",
    "verification:reverify",
    "verification:request-info",
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
    "profiles:export",
    "sensitive:income:view",
    "sensitive:notes:view",
    "sensitive:family:view",
    "staff:view",
    "profile:assign",
    "verification:assign",
    ...CASE_PERMISSIONS,
    ...PRIVACY_PERMISSIONS,
    ...FINANCE_ALL_PERMISSIONS,
    ...SYSTEM_ALL_PERMISSIONS,
    ...AI_ALL_PERMISSIONS,
    ...ROLES_ALL_PERMISSIONS,
    ...TASKS_ALL_PERMISSIONS,
  ],
  // legacy — retired, kept only so a not-yet-migrated row keeps its historical permission set unchanged
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
  ],
  // legacy — retired, kept only so a not-yet-migrated row keeps its historical permission set unchanged
  STAFF: [
    "profile:view",
    "profile:edit",
    "profile:status",
    "match:run",
    "proposal:create",
    "proposal:edit",
    "note:add",
    "communication:add",
    "verification:view",
    "verification:review",
    "verification:flag:manage",
    "communication:view",
    "communication:send",
    "reports:view",
    "reports:export",
    "sensitive:family:view",
    "support:view",
    "support:create",
    "cases:view",
    "cases:create",
    "cases:edit",
    "cases:resolve",
    "cases:close",
    "complaints:view",
    "safety_cases:view",
    "sensitive:case:evidence:view",
    "privacy:consent:view",
    "privacy:requests:view",
    "privacy_incidents:view",
    "finance:payments:view",
    "finance:invoices:view",
    "finance:refunds:request",
    "ai:use",
  ],
  // spec §16 also lists matches.view/proposals.view/meetings.view: this codebase has no
  // dedicated *view-only* permission for those today (matching/proposal visibility is
  // bundled into match:run/proposal:create, which also let the holder act, not just view) —
  // disclosed gap, not silently worked around by granting an action permission to a
  // read-only role. system:view is read-only (System Health/Config pages; no system:*:manage).
  VIEWER: ["profile:view", "audit:view", "verification:view", "communication:view", "reports:view", "system:view", "tasks:view", "tasks:view:own"],

  // ---------------------------------------------------------------- OPERATIONS_ADMIN (spec §5)
  OPERATIONS_ADMIN: [
    "profile:view",
    "profile:edit",
    "profile:archive",
    "profile:restore",
    "profile:restrict",
    "profile:suspend",
    "contact:reveal",
    "match:run",
    "proposal:create",
    "proposal:edit",
    "proposal:assign",
    "verification:view",
    "verification:review",
    "support:view",
    "cases:view",
    "cases:assign",
    "cases:escalate",
    "cases:resolve",
    "communication:view",
    "communication:send",
    "reports:view",
    "staff:view",
    "profile:assign",
    "system:view",
    "settings:edit",
    "audit:view",
    ...TASKS_ALL_PERMISSIONS,
    // deliberately lacks: admin:manage/roles:* (no role/permission management), finance:provider:manage,
    // finance:rollout:* (no unrestricted payment rollout control unless separately delegated),
    // system:restore:approve (no system recovery), releases:manage (no deployment control),
    // profile:delete (no permanent destructive action) — spec §5.
  ],

  // ---------------------------------------------------------------- MATCHMAKING_MANAGER (spec §6)
  MATCHMAKING_MANAGER: [
    "profile:view",
    "profile:edit",
    "match:run",
    "proposal:create",
    "proposal:edit",
    "proposal:finalize",
    "proposal:archive",
    "contact:reveal",
    "note:add",
    "notes:view",
    "notes:edit",
    "ai:use",
    "ai:copilot",
    "ai:communication:draft",
    "communication:view",
    "communication:send",
    "reports:view",
    ...MANAGER_TASK_PERMISSIONS,
    // deliberately lacks match:configure (cannot change matching algorithm weights, spec §6),
    // admin:manage / staff:view / roles:* (cannot manage staff permissions),
    // finance:* (cannot manage payment settings).
  ],

  // ---------------------------------------------------------------- VERIFICATION_MANAGER (spec §7)
  VERIFICATION_MANAGER: [
    "profile:view",
    "profile:edit",
    "verification:view",
    "verification:review",
    "verification:approve",
    "verification:reject",
    "verification:reverify",
    "verification:request-info",
    "verification:document:view",
    "sensitive:documents:view",
    "sensitive:contact:view",
    "cases:view",
    "cases:create",
    "cases:escalate",
    "reports:view",
    "audit:view",
    ...MANAGER_TASK_PERMISSIONS,
    // deliberately lacks proposal:finalize/contact:reveal (spec §7: cannot finalize proposals or
    // share contacts merely because verification is complete), finance:*, roles:*.
  ],

  // ---------------------------------------------------------------- SUPPORT_MANAGER (spec §8)
  SUPPORT_MANAGER: [
    "support:view",
    "support:create",
    "support:manage",
    "support:resolve",
    "support:close",
    "cases:view",
    "cases:assign",
    "cases:edit",
    "cases:escalate",
    "cases:escalate:senior", // spec's "senior" case-note tier moves here from legacy ADMIN, since this role now owns full case-management authority
    "cases:resolve",
    "cases:close",
    "cases:reopen",
    "complaints:view",
    "complaints:review",
    "complaints:resolve",
    "safety_cases:view",
    "safety_cases:review",
    "safety_cases:escalate",
    "safety_cases:resolve",
    "profile:restrict",
    "profile:suspend",
    "communication:view",
    "communication:send",
    "reports:view",
    "audit:view",
    ...MANAGER_TASK_PERMISSIONS,
    "tasks:escalate:senior", // spec's "senior" case-escalation tier already lives here (cases:escalate:senior above) — mirrors it for tasks
    // deliberately lacks sensitive:finance:*, proposal:finalize, roles:*.
  ],

  // ---------------------------------------------------------------- COMMUNICATION_MANAGER (spec §9)
  COMMUNICATION_MANAGER: [
    "communication:view",
    "communication:send",
    "communication:message:view",
    "notification:template:manage",
    "reports:view",
    "ai:use",
    "ai:communication:draft",
    ...MANAGER_TASK_PERMISSIONS,
    // deliberately lacks sensitive:contact:view/contact:reveal (cannot access private contact
    // details unless separately granted), contact:reveal:override, profile:edit, verification:*, finance:*.
    // Spec §9 also lists proposals.view/proposal_communications.view/meetings.view: same disclosed
    // gap as VIEWER above — no dedicated view-only permission for these exists yet.
  ],

  // ---------------------------------------------------------------- FINANCE_MANAGER (spec §10)
  FINANCE_MANAGER: [
    ...FINANCE_ALL_PERMISSIONS,
    "reports:view",
    "reports:export",
    "audit:view",
    ...MANAGER_TASK_PERMISSIONS,
    // deliberately lacks sensitive:income/family/notes/documents/contact:view, verification:*,
    // match:*, proposal:finalize, roles:*.
  ],

  // ---------------------------------------------------------------- STAFF_MATCHMAKER (spec §11)
  STAFF_MATCHMAKER: [
    "profile:view",
    "profile:edit",
    "match:run",
    "proposal:create",
    "proposal:edit",
    "note:add",
    "notes:view",
    "notes:edit",
    "communication:view",
    "communication:send",
    "ai:use",
    "ai:copilot",
    "ai:communication:draft",
    ...STAFF_TASK_PERMISSIONS,
    // sensitive:contact:view intentionally NOT granted by default — spec §11: requires the
    // permission AND approved consent/workflow, granted per-admin when actually needed.
  ],

  // ---------------------------------------------------------------- VERIFICATION_STAFF (spec §12)
  VERIFICATION_STAFF: [
    "profile:view",
    "profile:edit",
    "verification:view",
    "verification:review",
    "verification:request-info",
    "sensitive:documents:view",
    "cases:view",
    "communication:view",
    "communication:send",
    ...STAFF_TASK_PERMISSIONS,
    // deliberately lacks verification:approve/reject — only granted per-admin when explicitly
    // authorized (spec §12).
  ],

  // ---------------------------------------------------------------- SUPPORT_STAFF (spec §13)
  SUPPORT_STAFF: [
    "support:view",
    "support:create",
    "cases:view",
    "cases:edit",
    "cases:escalate",
    "communication:view",
    "communication:send",
    ...STAFF_TASK_PERMISSIONS,
    // deliberately lacks sensitive:documents/income/contact/notes:view (spec §13) unless separately granted.
  ],

  // ---------------------------------------------------------------- COMMUNICATION_STAFF (spec §14)
  COMMUNICATION_STAFF: [
    "communication:view",
    "communication:send",
    ...STAFF_TASK_PERMISSIONS,
    // deliberately lacks contact:reveal/sensitive:contact:view, profile:edit, verification:*, finance:*.
  ],

  // ---------------------------------------------------------------- REPORTING_ANALYST (spec §15)
  REPORTING_ANALYST: [
    "profile:view", // aggregate dashboards/reports are built from this; sensitive:* fields stay independently gated
    "reports:view",
    "reports:export",
    "profiles:export",
    "tasks:view",
    "tasks:view:all",
    "tasks:reports:view",
    // deliberately lacks profile:edit, proposal:edit, verification:review, contact:reveal,
    // finance:payments:manage, finance:refunds:*, staff:view, roles:*, settings:edit, and every
    // task mutation permission (create/assign/complete/escalate/etc.) — read-only analytics only.
  ],
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
