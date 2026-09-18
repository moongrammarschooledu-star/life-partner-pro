import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/permissions";

// Metadata-only registry backing the Permission Matrix UI's checkbox grid
// (src/app/admin/(shell)/permission-matrix/page.tsx) — NOT the authorization
// source of truth (that's ROLE_PERMISSIONS in src/lib/permissions.ts). Every
// permission string that exists gets a row here so it can be assigned to a
// custom role; descriptions are short, human-readable labels for the grid.
const DESCRIPTIONS: Partial<Record<Permission, string>> = {
  "profile:view": "View profile details",
  "profile:edit": "Edit profile information",
  "profile:delete": "Archive / soft-delete a profile",
  "profile:verify": "Mark a profile as verified",
  "profile:status": "Change a profile's status",
  "profile:assign": "Assign a profile to a staff member",
  "contact:reveal": "Reveal hidden contact information",
  "match:run": "Run and review the matching engine",
  "proposal:create": "Create a rishta proposal",
  "proposal:edit": "Edit an existing proposal",
  "proposal:assign": "Assign a proposal to a staff member",
  "note:add": "Add a private admin note",
  "communication:add": "Log a manual communication",
  "communication:view": "View communication history",
  "communication:send": "Send a communication",
  "communication:message:view": "View full message bodies",
  "audit:view": "View the audit log",
  "settings:edit": "Change platform settings",
  "admin:manage": "Manage admin accounts and roles",
  "verification:view": "View verification status",
  "verification:review": "Review a verification case",
  "verification:document:view": "View uploaded verification documents",
  "verification:flag:manage": "Manage security/trust flags",
  "verification:duplicate:scan": "Run duplicate-profile scans",
  "verification:assign": "Assign a verification case to staff",
  "notification:template:manage": "Edit notification templates",
  "reports:view": "View reports and analytics",
  "reports:export": "Export a report",
  "reports:income:view": "View income analytics",
  "reports:staff-performance:view": "View staff performance analytics",
  "reports:schedule:manage": "Schedule automated reports",
  "sensitive:income:view": "View individual income figures",
  "sensitive:notes:view": "View other admins' private notes",
  "sensitive:family:view": "View family background details",
  "staff:view": "View the team workload dashboard",
  // ---------- Support, Complaints, Safety & Case Management (STEP 12) ----------
  "support:view": "View support-request cases",
  "support:create": "Create a support-request case",
  "support:edit": "Edit a support-request case",
  "support:assign": "Assign a support-request case",
  "support:manage": "Manage support-request cases",
  "support:resolve": "Resolve a support-request case",
  "support:close": "Close a support-request case",
  "cases:view": "View cases",
  "cases:create": "Create an internal case",
  "cases:edit": "Edit a case",
  "cases:assign": "Assign a case to staff",
  "cases:manage": "Manage cases",
  "cases:escalate": "Escalate a case",
  "cases:escalate:senior": "Escalate a case to senior admin level",
  "cases:staff-conduct:view": "View staff-conduct complaint cases",
  "cases:resolve": "Resolve a case",
  "cases:close": "Close a case",
  "cases:reopen": "Reopen a closed case",
  "cases:merge": "Merge duplicate cases",
  "complaints:view": "View complaint cases",
  "complaints:create": "Create a complaint case",
  "complaints:review": "Review a complaint case",
  "complaints:resolve": "Resolve a complaint case",
  "safety_cases:view": "View safety-report cases",
  "safety_cases:review": "Review a safety-report case",
  "safety_cases:escalate": "Escalate a safety-report case",
  "safety_cases:resolve": "Resolve a safety-report case",
  "sensitive:case:evidence:view": "View case evidence files",
  "sensitive:case:notes:view": "View case internal notes above your tier",
  "sensitive:case:restricted-profile:view": "View cases involving restricted profiles",
  "profile:restrict": "Apply a scoped restriction to a profile",
  "profile:suspend": "Suspend a profile",
  // ---------- Data Privacy, Consent, Account Management & Retention (STEP 13) ----------
  "privacy:view": "View the Privacy Center",
  "privacy:manage": "Manage privacy settings",
  "privacy:consent:view": "View a profile's consent history",
  "privacy:consent:manage": "Manage a profile's consent records",
  "privacy:requests:view": "View privacy requests",
  "privacy:requests:manage": "Manage and resolve privacy requests",
  "privacy:export:view": "View data export requests",
  "privacy:export:create": "Create a data export on a profile's behalf",
  "privacy:delete:manage": "Approve or reject account deletion requests",
  "privacy:retention:view": "View retention policies",
  "privacy:retention:manage": "Configure retention policies",
  "privacy:hold:view": "View legal/administrative holds",
  "privacy:hold:manage": "Place or lift a legal/administrative hold",
  "privacy:incidents:view": "View privacy incidents",
  "privacy:incidents:manage": "Manage privacy incidents",
  "privacy:break-glass:manage": "Grant emergency break-glass access",
  "contact:reveal:override": "Share contact info outside an approved proposal",
  "sensitive:photos:view": "View profile photos",
  "privacy_incidents:view": "View privacy-incident cases",
  "privacy_incidents:review": "Review a privacy-incident case",
  "privacy_incidents:resolve": "Resolve a privacy-incident case",
  // ---------- Payment, Subscription, Packages & Financial Management (STEP 14) ----------
  "finance:view": "View the Finance Center",
  "finance:dashboard:view": "View the financial dashboard",
  "finance:payments:view": "View payments",
  "finance:payments:manage": "Manage payments and manual payment verification",
  "finance:invoices:view": "View invoices",
  "finance:invoices:manage": "Manage invoices",
  "finance:refunds:view": "View refunds",
  "finance:refunds:request": "Request a refund",
  "finance:refunds:approve": "Approve a refund",
  "finance:subscriptions:view": "View subscriptions",
  "finance:subscriptions:manage": "Manage subscriptions",
  "finance:packages:view": "View packages and pricing",
  "finance:packages:manage": "Manage packages, pricing, and entitlements",
  "finance:coupons:view": "View coupons and discounts",
  "finance:coupons:manage": "Manage coupons and discounts",
  "finance:reconciliation:view": "View financial reconciliation",
  "finance:reconciliation:manage": "Run financial reconciliation",
  "finance:reports:view": "View financial reports",
  "finance:reports:export": "Export a financial report",
  "sensitive:finance:view": "View sensitive financial details",
  "sensitive:finance:export": "Export sensitive financial data",

  // ---------- Payment Rollout Phases (STEP 14 add-on) ----------
  "finance:rollout:view": "View payment rollout stage, feature flags, and health",
  "finance:rollout:manage": "Change payment feature flags and beta/internal eligibility config",
  "finance:rollout:enable": "Advance the payment rollout stage forward",
  "finance:rollout:disable": "Disable payments (kill switch) or roll back the rollout stage",
  "finance:provider:manage": "Change the active payment provider or environment config",
  "finance:webhooks:view": "View payment webhook health and delivery status",
};

function moduleAndAction(key: Permission): { module: string; action: string } {
  const parts = key.split(":");
  return { module: parts[0], action: parts.slice(1).join(":") };
}

export async function ensurePermissionDefsSeeded(): Promise<void> {
  const keys = Object.keys(DESCRIPTIONS) as Permission[];
  await prisma.$transaction(
    keys.map((key) => {
      const { module, action } = moduleAndAction(key);
      return prisma.permissionDef.upsert({
        where: { key },
        update: { module, action, description: DESCRIPTIONS[key] ?? null },
        create: { key, module, action, description: DESCRIPTIONS[key] ?? null },
      });
    })
  );
}
