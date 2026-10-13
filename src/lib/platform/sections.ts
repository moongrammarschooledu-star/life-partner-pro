import type { Permission } from "@/lib/permissions";

// The Control Center navigation and section hubs (STEP 36 §3). Every section is either a page the Control Center OWNS (platform settings, features, providers,
// maintenance, announcements, history) or a HUB: a read-only summary of an existing area's configuration plus links to that area's own editor, which keeps its
// own validation, permissions and approvals. A section is shown only when the administrator holds the Control Center permission AND the domain permission
// listed here, and the server re-checks both before returning anything.

export type SectionGroup = "Overview" | "Platform" | "Governance" | "Business" | "Operations" | "Infrastructure";

export interface SectionLink {
  label: string;
  href: string;
  permission?: Permission;
}

export interface SectionDef {
  key: string;
  label: string;
  group: SectionGroup;
  description: string;
  /** Domain permission needed to see the section (in addition to platform:control_center:view). */
  requires?: Permission;
  /** A page the Control Center owns, instead of the generic hub. */
  page?: string;
  links: SectionLink[];
}

const CC = "/admin/control-center";

export const SECTIONS: SectionDef[] = [
  { key: "overview", label: "Control Center", group: "Overview", description: "Platform status, security, operations, business, infrastructure and deployment at a glance.", page: CC, links: [] },
  { key: "platform", label: "Platform Settings", group: "Platform", description: "Typed, versioned platform settings: identity, localization, public contact, status page.", requires: "platform:settings:view", page: `${CC}/platform`, links: [] },
  { key: "branding", label: "Branding", group: "Platform", description: "Brand colour, footer text, website address and public contact details.", requires: "platform:branding:view", page: `${CC}/branding`, links: [] },
  { key: "features", label: "Feature Flags", group: "Platform", description: "Feature flag states, controlled rollout and the emergency kill switches.", requires: "platform:features:view", page: `${CC}/features`, links: [{ label: "Older flag screen", href: "/admin/system-config", permission: "system:view" }] },
  { key: "providers", label: "Providers", group: "Platform", description: "Every provider with one status vocabulary and a safe connection test.", requires: "platform:providers:view", page: `${CC}/providers`, links: [] },
  { key: "authentication", label: "Authentication", group: "Governance", description: "Sign-in methods, password and two-factor policy, sessions and administrator accounts.", requires: "settings:edit", links: [{ label: "Security settings", href: "/admin/settings", permission: "settings:edit" }, { label: "Administrator accounts", href: "/admin/admin-users" }, { label: "Permission matrix", href: "/admin/permission-matrix" }] },
  { key: "security", label: "Security", group: "Governance", description: "Detection, alerts, incidents, administrator security and containment (Security Operations).", requires: "soc:view", links: [{ label: "Security Operations", href: "/admin/security-operations", permission: "soc:view" }, { label: "Security alerts", href: "/admin/security-alerts" }] },
  { key: "privacy", label: "Privacy", group: "Governance", description: "Consent, privacy notices, requests and deletion workflow.", requires: "privacy:view", links: [{ label: "Privacy Center", href: "/admin/privacy-center", permission: "privacy:view" }] },
  { key: "matching", label: "Matching", group: "Business", description: "Category weights (always shown normalised to 100%), tiers, hard requirements and result limits.", requires: "settings:edit", links: [{ label: "Matching settings", href: "/admin/settings", permission: "settings:edit" }, { label: "Matching Center", href: "/admin/matching", permission: "match:run" }] },
  { key: "verification", label: "Verification", group: "Business", description: "Verification policies, document verification and re-verification.", requires: "verification:policy:view", links: [{ label: "Verification policies", href: "/admin/verification/policies", permission: "verification:policy:view" }, { label: "Verification Center", href: "/admin/verification", permission: "verification:view" }] },
  { key: "proposals", label: "Proposals", group: "Business", description: "Proposal lifecycle, response windows, reminders and the consent-based contact-sharing workflow.", requires: "proposal:create", links: [{ label: "Proposals", href: "/admin/proposals", permission: "proposal:create" }, { label: "Approval policies", href: "/admin/approvals", permission: "approvals:view" }] },
  { key: "family", label: "Family", group: "Business", description: "Family invitations, delegated permissions and sharing levels. Family members never receive administrator permissions.", requires: "family:manage", links: [{ label: "Family accounts", href: "/admin/family-accounts", permission: "family:manage" }] },
  { key: "communication", label: "Communication", group: "Business", description: "Channels, providers, rate limits, retries, quiet hours, templates and suppression. Opt-out and consent are never bypassed.", requires: "communications:view", links: [{ label: "Communications", href: "/admin/communications", permission: "communications:view" }, { label: "Communication Center", href: "/admin/communication-center", permission: "communication:view" }] },
  { key: "crm", label: "CRM", group: "Business", description: "Lifecycle stages, lead sources, assignment and SLA.", requires: "crm:view", links: [{ label: "CRM", href: "/admin/crm", permission: "crm:view" }] },
  { key: "marketing", label: "Marketing", group: "Business", description: "Campaigns, lead forms, provider connections and limits. Sensitive attributes are never used for targeting.", requires: "marketing:view", links: [{ label: "Marketing", href: "/admin/marketing", permission: "marketing:view" }, { label: "Public website", href: "/admin/public-site", permission: "marketing:analytics:view" }] },
  { key: "membership", label: "Membership", group: "Business", description: "Packages, entitlements, coupons, referrals and promotions. Payment state stays in the payment system.", requires: "finance:entitlements:view", links: [{ label: "Membership Center", href: "/admin/membership", permission: "finance:entitlements:view" }, { label: "Packages", href: "/admin/packages", permission: "finance:packages:view" }] },
  { key: "payments", label: "Payments", group: "Business", description: "Payment provider, rollout stage (Disabled, Sandbox, Internal, Beta, Production) and the payment kill switch.", requires: "finance:view", links: [{ label: "Finance Center → Rollout", href: "/admin/finance-center", permission: "finance:view" }] },
  { key: "ai", label: "AI", group: "Business", description: "AI provider, rollout phase, limits, kill switch and per-feature control. AI stays human-controlled.", requires: "ai:view", links: [{ label: "AI Assistant", href: "/admin/ai", permission: "ai:view" }] },
  { key: "analytics", label: "Analytics", group: "Business", description: "Metric definitions, dashboards, refresh and retention.", requires: "analytics:view", links: [{ label: "Analytics & BI", href: "/admin/analytics", permission: "analytics:view" }] },
  { key: "notifications", label: "Notifications", group: "Business", description: "Notification events, channels, templates and quiet hours.", requires: "notification:template:manage", links: [{ label: "Notification templates", href: "/admin/notification-templates", permission: "notification:template:manage" }, { label: "Notification settings", href: "/admin/settings", permission: "settings:edit" }] },
  { key: "workflows", label: "Workflows", group: "Operations", description: "Task types, assignment, SLA, escalation and automation. Automation never bypasses consent, approval or privacy.", requires: "platform:workflows:view", links: [{ label: "Workflow & Tasks", href: "/admin/workflow", permission: "tasks:view" }] },
  { key: "approvals", label: "Approvals", group: "Operations", description: "Maker-checker policies for sensitive actions, including the platform actions added by the Control Center.", requires: "approvals:view", links: [{ label: "Approvals and policies", href: "/admin/approvals", permission: "approvals:view" }] },
  { key: "tasks", label: "Tasks", group: "Operations", description: "Task queues and SLA settings.", requires: "tasks:view", links: [{ label: "Workflow & Tasks", href: "/admin/workflow", permission: "tasks:view" }] },
  { key: "documents", label: "Documents", group: "Operations", description: "Allowed file types, size limits, categories and retention. Private documents are never public.", requires: "documents:view", links: [{ label: "Documents", href: "/admin/documents", permission: "documents:view" }] },
  { key: "support", label: "Support", group: "Operations", description: "Support inbox, cases and SLA.", requires: "cases:view", links: [{ label: "Support messages", href: "/admin/support" }, { label: "Case management", href: "/admin/case-management", permission: "cases:view" }] },
  { key: "risk", label: "Risk & Safety", group: "Governance", description: "Risk rules, thresholds and review queues. Rule changes are versioned; no automatic permanent suspension.", requires: "risk:view", links: [{ label: "Risk & Safety Center", href: "/admin/risk-center", permission: "risk:view" }] },
  { key: "backup", label: "Backup & DR", group: "Infrastructure", description: "Backups, restore tests, drills and the disaster-recovery plan.", requires: "soc:backups:view", links: [{ label: "Security Operations → Backups", href: "/admin/security-operations", permission: "soc:backups:view" }, { label: "System health", href: "/admin/system-health", permission: "system:view" }] },
  { key: "localization", label: "Localization", group: "Platform", description: "Languages, date and time format, currency display and time zone.", requires: "platform:settings:view", page: `${CC}/localization`, links: [] },
  { key: "legal", label: "Legal & Compliance", group: "Governance", description: "Jurisdictions, rules, pending legal review and provider compliance records. Legal requirements are never decided by software.", requires: "compliance:view", links: [{ label: "Compliance", href: "/admin/compliance", permission: "compliance:view" }, { label: "Retention (Privacy Center)", href: "/admin/privacy-center", permission: "privacy:view" }] },
  { key: "health", label: "System Health", group: "Infrastructure", description: "Application, database, storage, queue, e-mail, SMS, WhatsApp, payment, AI, backup and monitoring.", requires: "platform:health:view", page: `${CC}/health`, links: [] },
  { key: "audit", label: "Audit Logs", group: "Governance", description: "The configuration change log: what changed, who, why, when, with before and after (secrets hidden), compare and roll back.", requires: "platform:configuration:view", page: `${CC}/configuration-history`, links: [{ label: "Full audit log", href: "/admin/audit-log", permission: "audit:view" }] },
  { key: "deployment", label: "Deployment", group: "Infrastructure", description: "Version, commit, environment, migration, health, last backup and restore test. Read-only: no command can be run from here.", requires: "platform:deployment:view", page: `${CC}/deployment`, links: [{ label: "Deployment & Go-Live", href: "/admin/deployment", permission: "readiness:view" }] },
  { key: "maintenance", label: "Maintenance", group: "Infrastructure", description: "Scheduled and emergency maintenance, read-only mode, change freeze and break-glass.", requires: "platform:maintenance:view", page: `${CC}/maintenance`, links: [] },
  { key: "announcements", label: "Announcements", group: "Platform", description: "Maintenance, security and service notices for chosen audiences, and the public status page.", requires: "platform:announcements:view", page: `${CC}/announcements`, links: [{ label: "Public status page", href: "/status" }] },
];

export function sectionsFor(permissions: readonly string[]): SectionDef[] {
  if (!permissions.includes("platform:control_center:view")) return [];
  return SECTIONS.filter((s) => !s.requires || permissions.includes(s.requires));
}

export function findSection(key: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.key === key);
}

/** The links of a section the administrator may actually open. */
export function visibleLinks(section: SectionDef, permissions: readonly string[]): SectionLink[] {
  return section.links.filter((l) => !l.permission || permissions.includes(l.permission));
}
