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
  | "COMPLIANCE_MANAGER"
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
  "COMPLIANCE_MANAGER",
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
  | "staff:availability:manage"
  // ---------- Approval Governance (STEP 19) ----------
  | "approvals:view"
  | "approvals:create"
  | "approvals:submit"
  | "approvals:approve"
  | "approvals:reject"
  | "approvals:request-changes"
  | "approvals:assign"
  | "approvals:delegate"
  | "approvals:escalate"
  | "approvals:cancel"
  | "approvals:execute"
  | "approvals:audit:view"
  | "approvals:policy:view"
  | "approvals:policy:manage"
  | "approvals:emergency-override"
  | "approvals:bulk:view"
  | "approvals:bulk:approve"
  | "sensitive:approval:view"
  | "sensitive:approval:approve"
  | "sensitive:approval:execute"
  | "finance:approval:view"
  | "finance:approval:approve"
  | "finance:approval:execute"
  | "privacy:approval:view"
  | "privacy:approval:approve"
  | "privacy:approval:execute"
  | "security:approval:view"
  | "security:approval:approve"
  | "security:approval:execute"
  | "ai:approval:view"
  | "ai:approval:approve"
  | "ai:approval:execute"
  // ---------- Candidate Discovery & Matchmaking Workspace (STEP 20) ----------
  | "search:view"
  | "search:advanced"
  | "search:sensitive"
  | "search:export"
  | "search:saved:view"
  | "search:saved:create"
  | "search:saved:edit"
  | "search:saved:delete"
  | "search:bulk"
  | "candidate:view"
  | "candidate:compare"
  | "candidate:shortlist"
  | "candidate:recommend"
  // ---------- Family/Guardian Portal (STEP 22) ----------
  | "family:manage"
  // ---------- STEP 23 — KYC, Duplicate Detection & Safety Intelligence ----------
  | "risk:view"
  | "risk:review"
  | "risk:resolve"
  | "risk:escalate"
  | "risk:policy:view"
  | "risk:policy:manage"
  | "duplicates:view"
  | "duplicates:review"
  | "duplicates:resolve"
  | "duplicates:link"
  | "duplicates:manage"
  | "relationships:view"
  | "relationships:create"
  | "relationships:review"
  | "relationships:manage"
  | "documents:download"
  | "verification:policy:view"
  | "verification:policy:manage"
  | "safety:verification:restrict"
  | "safety:verification:suspend"
  | "sensitive:verification:view"
  | "sensitive:risk:view"
  // ---------- STEP 23 Add-on — Legal Jurisdiction & Regulatory Compliance ----------
  | "compliance:view"
  | "compliance:review"
  | "compliance:manage"
  | "compliance:rules:view"
  | "compliance:rules:manage"
  | "compliance:jurisdictions:view"
  | "compliance:jurisdictions:manage"
  | "compliance:providers:view"
  | "compliance:providers:manage"
  | "compliance:requests:view"
  | "compliance:requests:manage"
  | "compliance:authority-requests:view"
  | "compliance:authority-requests:manage"
  | "compliance:legal-holds:view"
  | "compliance:legal-holds:manage"
  | "compliance:audit:view"
  | "ai:compliance:use"
  | "sensitive:compliance:view"
  | "sensitive:authority-request:view"
  | "sensitive:legal-hold:view"
  // ---------- STEP 24 — Fraud Prevention & Account Safety Intelligence ----------
  // Existing risk:view/review/resolve/escalate and duplicates:* are kept as-is;
  // these are the additional spec permissions (risk:resolve == dismiss/false-positive).
  | "risk:investigate"
  | "risk:clear"
  | "risk:restrict"
  | "risk:suspend"
  | "risk:rules:view"
  | "risk:rules:manage"
  | "risk:configuration:view"
  | "risk:configuration:manage"
  | "risk:evidence:view"
  | "risk:evidence:manage"
  | "risk:reports:view"
  | "risk:reports:export"
  | "duplicates:merge"
  | "security:events:view"
  | "security:incidents:manage"
  | "user-reports:view"
  | "user-reports:manage"
  | "ai:risk:use"
  | "sensitive:security:view"
  | "sensitive:device:view"
  | "sensitive:network:view"
  | "sensitive:evidence:view"
  // ---------- STEP 25 - Communication, WhatsApp, SMS, Email & Conversation Management ----------
  // (colon style like the rest of the codebase; the spec writes the same names with dots.) The existing
  // communication:* strings stay untouched; these are the additional spec permissions.
  | "communications:view"
  | "communications:send"
  | "communications:send_sensitive"
  | "communications:bulk"
  | "communications:templates:view"
  | "communications:templates:create"
  | "communications:templates:edit"
  | "communications:templates:approve"
  | "communications:templates:activate"
  | "communications:campaigns:view"
  | "communications:campaigns:create"
  | "communications:campaigns:approve"
  | "communications:campaigns:manage"
  | "communications:providers:view"
  | "communications:providers:manage"
  | "communications:webhooks:view"
  | "communications:logs:view"
  | "communications:analytics:view"
  | "communications:export"
  | "communications:suppress"
  | "sensitive:communication:view"
  | "sensitive:communication:send"
  // ---------- STEP 26 - Secure Document Management, Verification, E-Signature & Lifecycle ----------
  // "documents:download" and "verification:document:view" above already exist and stay unchanged
  // (the STEP 8/23 identity-checklist upload routes use them); these are the additional spec permissions
  // for the new general Document system.
  | "documents:view"
  | "documents:upload"
  | "documents:edit"
  | "documents:review"
  | "documents:verify"
  | "documents:reject"
  | "documents:share"
  | "documents:revoke_share"
  | "documents:archive"
  | "documents:restore"
  | "documents:delete"
  | "documents:export"
  | "documents:redact"
  | "documents:manage_requests"
  | "documents:manage_providers"
  | "documents:manage_retention"
  | "documents:manage_legal_hold"
  | "documents:audit:view"
  | "documents:sign"
  | "documents:sign:manage"
  | "sensitive:documents:download"
  | "sensitive:documents:share"
  | "sensitive:documents:export"
  | "sensitive:identity_documents:view"
  // (family document access is governed by the separate FamilyPermissionKey catalog —
  // "document.view"/"document.comment"/"document.download" in src/lib/family/permissions.ts —
  // never by this AdminRole Permission type.)
  | "verification:documents:review"
  | "verification:documents:approve"
  | "verification:documents:reject"
  | "verification:documents:reverify"
  // ---------- STEP 27 — Membership, Packages, Entitlements, Coupons & Referrals ----------
  | "finance:entitlements:view"
  | "finance:entitlements:manage"
  | "finance:credits:view"
  | "finance:credits:manage"
  | "finance:pricing:view"
  | "referrals:view"
  | "referrals:manage"
  | "referrals:review"
  | "promotions:view"
  | "promotions:manage"
  // ---------- STEP 28 — CRM, Applicant Lifecycle & Lead Management ----------
  | "crm:view"
  | "crm:create"
  | "crm:edit"
  | "crm:archive"
  | "crm:restore"
  | "crm:assign"
  | "crm:reassign"
  | "crm:lifecycle:view"
  | "crm:lifecycle:manage"
  | "crm:leads:view"
  | "crm:leads:manage"
  | "crm:leads:convert"
  | "crm:notes:view"
  | "crm:notes:create"
  | "crm:notes:edit"
  | "crm:notes:delete"
  | "crm:notes:manager_view"
  | "crm:followups:view"
  | "crm:followups:create"
  | "crm:followups:edit"
  | "crm:followups:complete"
  | "crm:tags:view"
  | "crm:tags:manage"
  | "crm:search"
  | "crm:saved_views:view"
  | "crm:saved_views:create"
  | "crm:saved_views:edit"
  | "crm:saved_views:delete"
  | "crm:analytics:view"
  | "crm:reports:view"
  | "crm:export"
  | "crm:bulk"
  | "crm:merge:view"
  | "crm:merge:request"
  | "crm:merge:approve"
  | "crm:workflow:view"
  | "crm:workflow:manage"
  | "crm:sla:view"
  | "crm:sla:manage"
  | "crm:audit:view"
  | "sensitive:crm:view"
  | "sensitive:crm:export"
  | "sensitive:crm:notes:view"
  | "sensitive:crm:communication:view"
  | "sensitive:crm:documents:view"
  | "sensitive:crm:risk:view"
  | "ai:crm:use";

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
  "sensitive:approval:view",
  "sensitive:approval:approve",
  "search:sensitive",
  "sensitive:verification:view",
  "sensitive:risk:view",
  "sensitive:compliance:view",
  "sensitive:authority-request:view",
  "sensitive:legal-hold:view",
  "sensitive:security:view",
  "sensitive:device:view",
  "sensitive:network:view",
  "sensitive:evidence:view",
  "sensitive:communication:view",
  "sensitive:communication:send",
  "sensitive:documents:download",
  "sensitive:documents:share",
  "sensitive:documents:export",
  "sensitive:identity_documents:view",
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
  "COMPLIANCE_MANAGER",
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
  // ---------- STEP 27 ----------
  "finance:entitlements:view",
  "finance:entitlements:manage",
  "finance:credits:view",
  "finance:credits:manage",
  "finance:pricing:view",
  "referrals:view",
  "referrals:manage",
  "referrals:review",
  "promotions:view",
  "promotions:manage",
];

const CRM_ALL_PERMISSIONS: Permission[] = [
  "crm:view",
  "crm:create",
  "crm:edit",
  "crm:archive",
  "crm:restore",
  "crm:assign",
  "crm:reassign",
  "crm:lifecycle:view",
  "crm:lifecycle:manage",
  "crm:leads:view",
  "crm:leads:manage",
  "crm:leads:convert",
  "crm:notes:view",
  "crm:notes:create",
  "crm:notes:edit",
  "crm:notes:delete",
  "crm:followups:view",
  "crm:followups:create",
  "crm:followups:edit",
  "crm:followups:complete",
  "crm:tags:view",
  "crm:tags:manage",
  "crm:search",
  "crm:saved_views:view",
  "crm:saved_views:create",
  "crm:saved_views:edit",
  "crm:saved_views:delete",
  "crm:analytics:view",
  "crm:reports:view",
  "crm:export",
  "crm:bulk",
  "crm:merge:view",
  "crm:merge:request",
  "crm:merge:approve",
  "crm:workflow:view",
  "crm:workflow:manage",
  "crm:sla:view",
  "crm:sla:manage",
  "crm:audit:view",
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
  "ai:compliance:use",
  "ai:risk:use",
  "ai:crm:use",
];

// STEP 23 Add-on — the full compliance permission set; SUPER_ADMIN holds all
// of it, COMPLIANCE_MANAGER holds everything except platform-wide admin
// concerns it was never meant to carry (mirrors PRIVACY_PERMISSIONS's own
// SUPER_ADMIN-vs-scoped-role split above).
const COMPLIANCE_ALL_PERMISSIONS: Permission[] = [
  "compliance:view",
  "compliance:review",
  "compliance:manage",
  "compliance:rules:view",
  "compliance:rules:manage",
  "compliance:jurisdictions:view",
  "compliance:jurisdictions:manage",
  "compliance:providers:view",
  "compliance:providers:manage",
  "compliance:requests:view",
  "compliance:requests:manage",
  "compliance:authority-requests:view",
  "compliance:authority-requests:manage",
  "compliance:legal-holds:view",
  "compliance:legal-holds:manage",
  "compliance:audit:view",
  "sensitive:compliance:view",
  "sensitive:authority-request:view",
  "sensitive:legal-hold:view",
];

// STEP 24 — the full risk & safety permission set (additive to the STEP 23
// risk:view/review/resolve/escalate + duplicates:* strings, which stay as they
// are). SUPER_ADMIN holds all of it; the manager roles below get scoped
// subsets, and the sensitive:* ones are never implied by a manager role.
const RISK_ALL_PERMISSIONS: Permission[] = [
  "risk:view",
  "risk:review",
  "risk:investigate",
  "risk:resolve",
  "risk:clear",
  "risk:escalate",
  "risk:restrict",
  "risk:suspend",
  "risk:rules:view",
  "risk:rules:manage",
  "risk:configuration:view",
  "risk:configuration:manage",
  "risk:evidence:view",
  "risk:evidence:manage",
  "risk:reports:view",
  "risk:reports:export",
  "duplicates:merge",
  "security:events:view",
  "security:incidents:manage",
  "user-reports:view",
  "user-reports:manage",
  "sensitive:security:view",
  "sensitive:device:view",
  "sensitive:network:view",
  "sensitive:evidence:view",
];

// STEP 25 - the full communication permission set. SUPER_ADMIN holds all of it; every other role gets a scoped
// subset below. The two sensitive:communication:* strings are never implied by a manager role. Maker-checker
// separation on templates/campaigns is enforced structurally by the STEP 19 gate and by explicit no-self-approval
// checks in the services, not by withholding a permission from a role.
const COMMUNICATIONS_ALL_PERMISSIONS: Permission[] = [
  "communications:view",
  "communications:send",
  "communications:send_sensitive",
  "communications:bulk",
  "communications:templates:view",
  "communications:templates:create",
  "communications:templates:edit",
  "communications:templates:approve",
  "communications:templates:activate",
  "communications:campaigns:view",
  "communications:campaigns:create",
  "communications:campaigns:approve",
  "communications:campaigns:manage",
  "communications:providers:view",
  "communications:providers:manage",
  "communications:webhooks:view",
  "communications:logs:view",
  "communications:analytics:view",
  "communications:export",
  "communications:suppress",
  "sensitive:communication:view",
  "sensitive:communication:send",
];

// STEP 26 - the full document-management permission set. SUPER_ADMIN holds all of it; every other role gets a
// scoped subset below (verification review/approve stays with VERIFICATION_MANAGER/STAFF, legal hold/retention/
// provider configuration with COMPLIANCE_MANAGER, matching the STEP 25 COMMUNICATIONS_ALL_PERMISSIONS shape above).
const DOCUMENTS_ALL_PERMISSIONS: Permission[] = [
  "documents:view",
  "documents:upload",
  "documents:edit",
  "documents:review",
  "documents:verify",
  "documents:reject",
  "documents:share",
  "documents:revoke_share",
  "documents:archive",
  "documents:restore",
  "documents:delete",
  "documents:export",
  "documents:redact",
  "documents:manage_requests",
  "documents:manage_providers",
  "documents:manage_retention",
  "documents:manage_legal_hold",
  "documents:audit:view",
  "documents:sign",
  "documents:sign:manage",
  "documents:download",
  "sensitive:documents:download",
  "sensitive:documents:share",
  "sensitive:documents:export",
  "sensitive:identity_documents:view",
  "verification:documents:review",
  "verification:documents:approve",
  "verification:documents:reject",
  "verification:documents:reverify",
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

// STEP 19 — full governance permission set (SUPER_ADMIN only): the 16
// approvals:* strings plus every domain-tiered sensitive/finance/privacy/
// security/ai approval permission. approvals:policy:manage and
// approvals:emergency-override are exclusive to this bundle — spec §9/§25
// restrict both to Super Admin explicitly.
const APPROVALS_ALL_PERMISSIONS: Permission[] = [
  "approvals:view",
  "approvals:create",
  "approvals:submit",
  "approvals:approve",
  "approvals:reject",
  "approvals:request-changes",
  "approvals:assign",
  "approvals:delegate",
  "approvals:escalate",
  "approvals:cancel",
  "approvals:execute",
  "approvals:audit:view",
  "approvals:policy:view",
  "approvals:policy:manage",
  "approvals:emergency-override",
  "approvals:bulk:view",
  "approvals:bulk:approve",
  "sensitive:approval:view",
  "sensitive:approval:approve",
  "sensitive:approval:execute",
  "finance:approval:view",
  "finance:approval:approve",
  "finance:approval:execute",
  "privacy:approval:view",
  "privacy:approval:approve",
  "privacy:approval:execute",
  "security:approval:view",
  "security:approval:approve",
  "security:approval:execute",
  "ai:approval:view",
  "ai:approval:approve",
  "ai:approval:execute",
];

// STEP 19 — OPERATIONS_ADMIN gets everything SUPER_ADMIN has for governance
// EXCEPT policy configuration and the emergency override (spec §9/§25 name
// Super Admin specifically for both).
const OPERATIONS_APPROVAL_PERMISSIONS: Permission[] = APPROVALS_ALL_PERMISSIONS.filter(
  (p) => p !== "approvals:policy:manage" && p !== "approvals:emergency-override",
);

// STEP 19 — each *_MANAGER role's baseline governance permissions: can
// create, decide (approve/reject/request-changes), cancel and escalate
// requests in their own domain (the actual domain scoping comes from each
// ApprovalPolicy's allowedRoles, not from holding this permission set), plus
// read the audit trail. Never policy:manage, emergency-override, or execute —
// execution stays with Super Admin/Operations Admin or a domain-specific
// finance:approval:execute-style grant (spec §39: "never grant approval
// permissions merely because a role exists").
const MANAGER_APPROVAL_PERMISSIONS: Permission[] = [
  "approvals:view",
  "approvals:create",
  "approvals:submit",
  "approvals:approve",
  "approvals:reject",
  "approvals:request-changes",
  "approvals:cancel",
  "approvals:escalate",
  "approvals:audit:view",
];

// STEP 19 — every *_STAFF role: may create/submit a high-risk action request
// (the "maker") but can never approve/reject/execute one, per spec §39.
const STAFF_APPROVAL_PERMISSIONS: Permission[] = ["approvals:view", "approvals:create", "approvals:submit"];

// STEP 20 — full Candidate Discovery permission set (SUPER_ADMIN/OPERATIONS_ADMIN).
const SEARCH_ALL_PERMISSIONS: Permission[] = [
  "search:view", "search:advanced", "search:sensitive", "search:export",
  "search:saved:view", "search:saved:create", "search:saved:edit", "search:saved:delete", "search:bulk",
  "candidate:view", "candidate:compare", "candidate:shortlist", "candidate:recommend",
];

// STEP 20 — MATCHMAKING_MANAGER's own domain: full discovery/matchmaking
// authority, but never search:sensitive/search:export unless separately
// granted (those stay tied to the underlying sensitive:*/export permission).
const MATCHMAKING_SEARCH_PERMISSIONS: Permission[] = [
  "search:view", "search:advanced", "search:saved:view", "search:saved:create", "search:saved:edit", "search:bulk",
  "candidate:view", "candidate:compare", "candidate:shortlist", "candidate:recommend",
];

// STEP 20 — every other *_MANAGER role: can view candidates for their own
// domain's relevance (e.g. verification/support context) but not the full
// matchmaking-workspace authority.
const MANAGER_SEARCH_PERMISSIONS: Permission[] = ["search:view", "search:saved:view", "candidate:view"];

// STEP 20 — every *_STAFF role: assignment-scoped search + shortlisting,
// never advanced filters, export, or saved-preset management.
const STAFF_SEARCH_PERMISSIONS: Permission[] = ["search:view", "candidate:view", "candidate:shortlist"];

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
    // ---------- STEP 23 ----------
    "risk:view",
    "risk:review",
    "risk:resolve",
    "risk:escalate",
    "risk:policy:view",
    "risk:policy:manage",
    "duplicates:view",
    "duplicates:review",
    "duplicates:resolve",
    "duplicates:link",
    "duplicates:manage",
    "relationships:view",
    "relationships:create",
    "relationships:review",
    "relationships:manage",
    "documents:download",
    "verification:policy:view",
    "verification:policy:manage",
    "safety:verification:restrict",
    "safety:verification:suspend",
    "sensitive:verification:view",
    "sensitive:risk:view",
    ...CASE_PERMISSIONS,
    ...PRIVACY_PERMISSIONS,
    ...FINANCE_ALL_PERMISSIONS,
    ...SYSTEM_ALL_PERMISSIONS,
    ...AI_ALL_PERMISSIONS,
    ...RISK_ALL_PERMISSIONS,
    ...COMMUNICATIONS_ALL_PERMISSIONS,
    ...DOCUMENTS_ALL_PERMISSIONS,
    ...CRM_ALL_PERMISSIONS,
    "crm:notes:manager_view",
    "sensitive:crm:view",
    "sensitive:crm:export",
    "sensitive:crm:notes:view",
    "sensitive:crm:communication:view",
    "sensitive:crm:documents:view",
    "sensitive:crm:risk:view",
    ...ROLES_ALL_PERMISSIONS,
    ...TASKS_ALL_PERMISSIONS,
    ...APPROVALS_ALL_PERMISSIONS,
    ...SEARCH_ALL_PERMISSIONS,
    ...COMPLIANCE_ALL_PERMISSIONS,
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
    "family:manage",
  ],
  // spec §16 also lists matches.view/proposals.view/meetings.view: this codebase has no
  // dedicated *view-only* permission for those today (matching/proposal visibility is
  // bundled into match:run/proposal:create, which also let the holder act, not just view) —
  // disclosed gap, not silently worked around by granting an action permission to a
  // read-only role. system:view is read-only (System Health/Config pages; no system:*:manage).
  VIEWER: ["profile:view", "audit:view", "verification:view", "communication:view", "documents:view", "reports:view", "system:view", "tasks:view", "tasks:view:own", "approvals:view", "search:view", "crm:view"],

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
    // STEP 25 - operations can watch the communication pipeline (queue, logs, providers, analytics) and send, but not configure providers.
    "communications:view",
    "communications:send",
    "communications:templates:view",
    "communications:campaigns:view",
    "communications:providers:view",
    "communications:webhooks:view",
    "communications:logs:view",
    "communications:analytics:view",
    // STEP 26 - operations can watch the document pipeline (queue/audit) but not review, verify, or configure it.
    "documents:view",
    "documents:audit:view",
    "reports:view",
    "staff:view",
    "profile:assign",
    "system:view",
    "settings:edit",
    "audit:view",
    ...TASKS_ALL_PERMISSIONS,
    ...OPERATIONS_APPROVAL_PERMISSIONS,
    ...SEARCH_ALL_PERMISSIONS,
    "family:manage",
    // STEP 28 — CRM oversight sits with Operations (no dedicated "CRM Manager"
    // role exists or is created by this STEP), including the manager-only
    // note tier and merge approval; sensitive:crm:* covers viewing/exporting
    // linked communication/document/risk data surfaced inside the CRM.
    ...CRM_ALL_PERMISSIONS,
    "crm:notes:manager_view",
    "ai:crm:use",
    "sensitive:crm:view",
    "sensitive:crm:export",
    "sensitive:crm:notes:view",
    "sensitive:crm:communication:view",
    "sensitive:crm:documents:view",
    "sensitive:crm:risk:view",
    // deliberately lacks: admin:manage/roles:* (no role/permission management), finance:provider:manage,
    // finance:rollout:* (no unrestricted payment rollout control unless separately delegated),
    // system:restore:approve (no system recovery), releases:manage (no deployment control),
    // profile:delete (no permanent destructive action) — spec §5.
    // approvals:policy:manage/approvals:emergency-override deliberately excluded from
    // OPERATIONS_APPROVAL_PERMISSIONS — spec §9/§25 reserve both to Super Admin.
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
    ...MANAGER_APPROVAL_PERMISSIONS,
    ...MATCHMAKING_SEARCH_PERMISSIONS,
    // STEP 28 — a superset of STAFF_MATCHMAKER's CRM grants (role-management's
    // manager-superset invariant), plus manager-level note/assignment oversight.
    "crm:view",
    "crm:lifecycle:view",
    "crm:notes:view",
    "crm:notes:create",
    "crm:notes:edit",
    "crm:notes:delete",
    "crm:followups:view",
    "crm:followups:create",
    "crm:followups:edit",
    "crm:followups:complete",
    "crm:tags:view",
    "crm:search",
    "crm:assign",
    "crm:reassign",
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
    // ---------- STEP 23 ----------
    "risk:view",
    "risk:review",
    "risk:resolve",
    "duplicates:view",
    "duplicates:review",
    "duplicates:resolve",
    "duplicates:link",
    "relationships:view",
    "relationships:create",
    "relationships:review",
    "documents:download",
    "verification:policy:view",
    "sensitive:verification:view",
    "sensitive:risk:view",
    // STEP 24 — reviews/investigates risk cases and verification-related evidence; clearing,
    // restricting and suspending stay elsewhere (see the deliberate-lacks note below).
    "risk:investigate",
    "risk:evidence:view",
    "user-reports:view",
    "ai:risk:use",
    // STEP 26 — owns document review/verification decisions and can request documents from applicants;
    // legal hold/retention/provider configuration stay with COMPLIANCE_MANAGER (see the lacks-note below).
    "documents:view",
    "documents:review",
    "documents:verify",
    "documents:reject",
    "documents:manage_requests",
    "verification:documents:review",
    "verification:documents:approve",
    "verification:documents:reject",
    "verification:documents:reverify",
    "sensitive:identity_documents:view",
    ...MANAGER_TASK_PERMISSIONS,
    ...MANAGER_APPROVAL_PERMISSIONS,
    ...MANAGER_SEARCH_PERMISSIONS,
    // STEP 28 — a superset of VERIFICATION_STAFF's CRM grants (role-management's
    // "a manager can grant any role whose permissions it fully holds" invariant),
    // plus manager-level note/assignment oversight.
    "crm:view",
    "crm:lifecycle:view",
    "crm:notes:view",
    "crm:notes:create",
    "crm:notes:edit",
    "crm:notes:delete",
    "crm:followups:view",
    "crm:followups:create",
    "crm:followups:edit",
    "crm:followups:complete",
    "crm:tags:view",
    "crm:search",
    "crm:assign",
    "crm:reassign",
    // deliberately lacks proposal:finalize/contact:reveal (spec §7: cannot finalize proposals or
    // share contacts merely because verification is complete), finance:*, roles:*,
    // risk:escalate/risk:policy:manage/verification:policy:manage/duplicates:manage/
    // relationships:manage/safety:verification:* (policy-setting and safety-restriction
    // authority stay with Support Manager/Super Admin, spec §44). Also lacks
    // documents:manage_legal_hold/manage_retention/manage_providers/export (Compliance Manager, spec §53/§54/§60).
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
    // STEP 24 — owns safety-restriction authority (matches the STEP 23 note above);
    // every consequential action still goes through the STEP 19 gate.
    "risk:review",
    "risk:investigate",
    "risk:restrict",
    "risk:suspend",
    "risk:evidence:view",
    "user-reports:view",
    "user-reports:manage",
    "ai:risk:use",
    "communication:view",
    "communication:send",
    "communications:view",
    "communications:send",
    "communications:templates:view",
    "reports:view",
    "audit:view",
    // ---------- STEP 23 ----------
    "risk:view",
    "risk:escalate",
    "safety:verification:restrict",
    "safety:verification:suspend",
    "sensitive:risk:view",
    // STEP 26 — can request/review support-evidence-style documents on a case, and archive them once resolved.
    "documents:view",
    "documents:manage_requests",
    "documents:review",
    "documents:archive",
    ...MANAGER_TASK_PERMISSIONS,
    "tasks:escalate:senior", // spec's "senior" case-escalation tier already lives here (cases:escalate:senior above) — mirrors it for tasks
    ...MANAGER_APPROVAL_PERMISSIONS,
    "security:approval:view",
    "security:approval:approve", // STEP 19 §6 SAFETY domain (SAFETY_RESTRICTION/PROFILE_SUSPENSION/SAFETY_CASE_ESCALATION) sits with Support Manager, mirroring safety_cases:* above
    ...MANAGER_SEARCH_PERMISSIONS,
    "family:manage",
    // STEP 28 — a superset of SUPPORT_STAFF's CRM grants (role-management's
    // manager-superset invariant), plus manager-level note/assignment oversight.
    "crm:view",
    "crm:notes:view",
    "crm:notes:create",
    "crm:notes:edit",
    "crm:notes:delete",
    "crm:followups:view",
    "crm:followups:create",
    "crm:followups:edit",
    "crm:followups:complete",
    "crm:search",
    "crm:assign",
    "crm:reassign",
    // deliberately lacks sensitive:finance:*, proposal:finalize, roles:*, security:approval:execute
    // (execution of a security override stays with Super Admin/Operations Admin).
  ],

  // ---------------------------------------------------------------- COMMUNICATION_MANAGER (spec §9)
  COMMUNICATION_MANAGER: [
    "communication:view",
    "communication:send",
    "communication:message:view",
    "notification:template:manage",
    // STEP 25 - owns templates, campaigns, queue/analytics and suppression; NOT provider configuration
    // (COMPLIANCE_MANAGER / SUPER_ADMIN) and NOT the sensitive:communication:* strings.
    "communications:view",
    "communications:send",
    "communications:bulk",
    "communications:templates:view",
    "communications:templates:create",
    "communications:templates:edit",
    "communications:templates:approve",
    "communications:templates:activate",
    "communications:campaigns:view",
    "communications:campaigns:create",
    "communications:campaigns:approve",
    "communications:campaigns:manage",
    "communications:providers:view",
    "communications:webhooks:view",
    "communications:logs:view",
    "communications:analytics:view",
    "communications:suppress",
    "reports:view",
    "ai:use",
    "ai:communication:draft",
    ...MANAGER_TASK_PERMISSIONS,
    ...MANAGER_APPROVAL_PERMISSIONS,
    ...MANAGER_SEARCH_PERMISSIONS,
    // STEP 28 — a superset of COMMUNICATION_STAFF's sole CRM grant (role-management's manager-superset invariant).
    "crm:view",
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
    ...MANAGER_APPROVAL_PERMISSIONS,
    "finance:approval:view",
    "finance:approval:approve",
    "finance:approval:execute",
    ...MANAGER_SEARCH_PERMISSIONS,
    // deliberately lacks sensitive:income/family/notes/documents/contact:view, verification:*,
    // match:*, proposal:finalize, roles:*.
  ],

  // ---------------------------------------------------------------- COMPLIANCE_MANAGER (STEP 23 add-on)
  // The first new role since STEP 17 — every prior step only assigned
  // permissions to existing roles. Mirrors FINANCE_MANAGER's exact shape:
  // the full domain permission spread, plus reporting/task/approval/search
  // access. Maker-checker separation on any individual high-risk compliance
  // action is enforced structurally by STEP 19's gate (a maker can never be
  // their own approver on the same ApprovalRequest), not by withholding a
  // permission from this role.
  COMPLIANCE_MANAGER: [
    "profile:view",
    ...COMPLIANCE_ALL_PERMISSIONS,
    "ai:compliance:use",
    // STEP 25 - provider configuration, webhook/log oversight, suppression and approval of external-facing templates/campaigns.
    "communications:view",
    "communications:templates:view",
    "communications:templates:approve",
    "communications:templates:activate",
    "communications:campaigns:view",
    "communications:campaigns:approve",
    "communications:providers:view",
    "communications:providers:manage",
    "communications:webhooks:view",
    "communications:logs:view",
    "communications:analytics:view",
    "communications:export",
    "communications:suppress",
    // STEP 24 — owns risk rules/configuration/reporting and admin-security review.
    "risk:view",
    "risk:rules:view",
    "risk:rules:manage",
    "risk:configuration:view",
    "risk:configuration:manage",
    "risk:evidence:view",
    "risk:reports:view",
    "risk:reports:export",
    "security:events:view",
    "sensitive:security:view",
    "ai:risk:use",
    "reports:view",
    "reports:export",
    "audit:view",
    "cases:view",
    "cases:create",
    "cases:escalate",
    // STEP 26 — owns legal hold, retention and OCR/scan/signature provider configuration; document
    // review/verification decisions stay with VERIFICATION_MANAGER (see the lacks-note below).
    "documents:view",
    "documents:manage_legal_hold",
    "documents:manage_retention",
    "documents:manage_providers",
    "documents:audit:view",
    "documents:export",
    "sensitive:documents:export",
    ...MANAGER_TASK_PERMISSIONS,
    ...MANAGER_APPROVAL_PERMISSIONS,
    "privacy:approval:view",
    "privacy:approval:approve",
    "security:approval:view",
    "security:approval:approve",
    ...MANAGER_SEARCH_PERMISSIONS,
    // deliberately lacks admin:manage/roles:*, finance:*, verification:approve/reject
    // (identity-verification decisions stay with VERIFICATION_MANAGER), profile:edit,
    // documents:review/verify/reject (document REVIEW decisions stay with VERIFICATION_MANAGER).
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
    ...STAFF_APPROVAL_PERMISSIONS,
    ...STAFF_SEARCH_PERMISSIONS,
    "search:advanced",
    "candidate:recommend", // STEP 20 — matchmaking staff specifically may run mutual-candidate search + advanced filters, unlike other *_STAFF roles
    // sensitive:contact:view intentionally NOT granted by default — spec §11: requires the
    // permission AND approved consent/workflow, granted per-admin when actually needed.
    // STEP 28 — matchmaking staff work the CRM pipeline day-to-day: view/lifecycle-view,
    // their own notes/follow-ups, tags read, search. No merge/bulk/export/workflow-manage.
    "crm:view",
    "crm:lifecycle:view",
    "crm:notes:view",
    "crm:notes:create",
    "crm:followups:view",
    "crm:followups:create",
    "crm:followups:edit",
    "crm:followups:complete",
    "crm:tags:view",
    "crm:search",
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
    // STEP 26 — can review and request documents; final approve/reject/reverify stays per-admin (mirrors verification:approve/reject below).
    "documents:view",
    "documents:review",
    "documents:manage_requests",
    "verification:documents:review",
    ...STAFF_TASK_PERMISSIONS,
    ...STAFF_APPROVAL_PERMISSIONS,
    ...STAFF_SEARCH_PERMISSIONS,
    // deliberately lacks verification:approve/reject — only granted per-admin when explicitly
    // authorized (spec §12). Same for documents:verify/reject/verification:documents:approve/reject/reverify.
    // STEP 28 — verification staff can see/annotate the CRM record while reviewing, not manage it broadly.
    "crm:view",
    "crm:lifecycle:view",
    "crm:notes:view",
    "crm:notes:create",
    "crm:followups:view",
    "crm:followups:create",
    "crm:followups:complete",
    "crm:search",
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
    "communications:view",
    "communications:send",
    // STEP 26 — can request a document to resolve a case (spec §58); no review/verify authority.
    "documents:manage_requests",
    ...STAFF_TASK_PERMISSIONS,
    ...STAFF_APPROVAL_PERMISSIONS,
    ...STAFF_SEARCH_PERMISSIONS,
    // deliberately lacks sensitive:documents/income/contact/notes:view (spec §13) unless separately granted.
    // STEP 28 — support staff need CRM context (open cases/notes/follow-ups) for the applicant they're helping.
    "crm:view",
    "crm:notes:view",
    "crm:notes:create",
    "crm:followups:view",
    "crm:followups:create",
    "crm:followups:complete",
    "crm:search",
  ],

  // ---------------------------------------------------------------- COMMUNICATION_STAFF (spec §14)
  COMMUNICATION_STAFF: [
    "communication:view",
    "communication:send",
    "communications:view",
    "communications:send",
    "communications:templates:view",
    ...STAFF_TASK_PERMISSIONS,
    ...STAFF_APPROVAL_PERMISSIONS,
    ...STAFF_SEARCH_PERMISSIONS,
    // deliberately lacks contact:reveal/sensitive:contact:view, profile:edit, verification:*, finance:*.
    // STEP 28 — read-only CRM context before sending a message; no note/follow-up authoring here.
    "crm:view",
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
    "approvals:view",
    "approvals:audit:view",
    "search:view",
    // deliberately lacks profile:edit, proposal:edit, verification:review, contact:reveal,
    // finance:payments:manage, finance:refunds:*, staff:view, roles:*, settings:edit, and every
    // task mutation permission (create/assign/complete/escalate/etc.) — read-only analytics only.
    // Same for approvals:* — no create/approve/reject/execute, read-only governance analytics (spec §39).
    // Same for search:* — view-only, no candidate:*/advanced/sensitive/export (spec §46's analytics-only framing).
    // STEP 28 — read-only CRM analytics/reports/export, no record mutation.
    "crm:view",
    "crm:analytics:view",
    "crm:reports:view",
    "crm:export",
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
