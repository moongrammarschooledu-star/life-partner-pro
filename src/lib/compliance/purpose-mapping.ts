import type { Permission } from "@/lib/permissions";
import type { DataProcessingPurpose } from "@prisma/client";

// STEP 23 Add-on §11/§14 — purpose-limitation tagging. Every existing admin
// permission string already encodes which domain a route belongs to
// ("profile:view", "verification:approve", "finance:refund:approve", ...);
// this maps that domain to a DataProcessingPurpose so an access can be
// tagged with its purpose WITHOUT touching each of the ~200 existing routes
// individually — the tag is derived from the permission the route already
// checks via requireAdmin(permission).
//
// Deliberately additive, not a gate: this only labels why an access
// happened (extends src/lib/privacy/access-log.ts's existing, explicitly
// non-gating logPrivacyAccess()). It does NOT block anything — the
// sensitive routes that already have bespoke, mature enforcement
// (assertContactShareAllowed's consent re-validation, hasActiveRestriction,
// permission-tier checks) keep working exactly as before. Retrofitting a
// generic consent-vs-purpose BLOCK on top of those would duplicate or
// conflict with logic that already correctly encodes this app's actual
// legal-basis decisions per route — that is a product decision for each
// route individually, not something a blanket mapping can safely automate.
const MODULE_PURPOSE: Record<string, DataProcessingPurpose> = {
  admin: "ACCOUNT_OPERATION",
  "admin-users": "ACCOUNT_OPERATION",
  ai: "AI_ASSISTANCE",
  alerts: "SECURITY",
  approvals: "ACCOUNT_OPERATION",
  audit: "SECURITY",
  candidate: "MATCHMAKING",
  cases: "CUSTOMER_SUPPORT",
  communication: "CONTACT_SHARING",
  complaints: "CUSTOMER_SUPPORT",
  compliance: "LEGAL_COMPLIANCE",
  contact: "CONTACT_SHARING",
  documents: "IDENTITY_VERIFICATION",
  duplicates: "FRAUD_PREVENTION",
  family: "ACCOUNT_OPERATION",
  finance: "PAYMENT_PROCESSING",
  match: "MATCHMAKING",
  note: "CUSTOMER_SUPPORT",
  notes: "CUSTOMER_SUPPORT",
  notification: "ACCOUNT_OPERATION",
  privacy: "LEGAL_COMPLIANCE",
  profile: "MATCHMAKING",
  profiles: "MATCHMAKING",
  proposal: "PROPOSAL_MANAGEMENT",
  readiness: "SECURITY",
  relationships: "FRAUD_PREVENTION",
  releases: "SECURITY",
  reports: "ANALYTICS",
  risk: "FRAUD_PREVENTION",
  roles: "ACCOUNT_OPERATION",
  safety: "SAFETY",
  search: "MATCHMAKING",
  security: "SECURITY",
  settings: "ACCOUNT_OPERATION",
  staff: "ACCOUNT_OPERATION",
  support: "CUSTOMER_SUPPORT",
  system: "SECURITY",
  tasks: "ACCOUNT_OPERATION",
  verification: "IDENTITY_VERIFICATION",
};

const DEFAULT_PURPOSE: DataProcessingPurpose = "ACCOUNT_OPERATION";

// "sensitive:contact:view" -> module is the SECOND segment ("contact"), not
// "sensitive" itself, since every sensitive:* permission is scoped to a
// specific domain the same way its non-sensitive counterpart is.
export function resolvePurposeForPermission(permission: Permission): DataProcessingPurpose {
  const segments = permission.split(":");
  const moduleName = segments[0] === "sensitive" ? segments[1] : segments[0];
  return MODULE_PURPOSE[moduleName] ?? DEFAULT_PURPOSE;
}
