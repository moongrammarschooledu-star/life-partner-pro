import { prisma } from "@/lib/prisma";
import { hasActiveRestriction } from "@/lib/profile-restrictions";
import { hasActiveHold } from "@/lib/privacy/data-hold";
import { getFamilyMembership, hasFamilyPermission } from "@/lib/family/access-control";
import type { Document, DocumentAccessAction, DocumentClassification } from "@prisma/client";

// Family document sharing deliberately does NOT reuse the generic FamilySharedRecord model: its
// accessLevel (ProposalSharingLevel: SUMMARY/STANDARD/DETAILED/...) has no VIEW/DOWNLOAD concept, which
// documents specifically need (spec §24's "VIEW is separate from DOWNLOAD"). A family member's document
// access is instead just an ordinary DocumentShare row (recipientType FAMILY_MEMBER) — the exact same
// explicit, expiring, scoped grant every other recipient type uses.

// The single choke point every document read/write goes through (spec §24/§25/§26 combined into one
// engine, mirroring src/lib/communications/policy-engine.ts's shape). Nothing outside this file decides
// whether an actor may touch a document.

export type DocumentActorType = "PROFILE" | "FAMILY_MEMBER" | "ADMIN" | "SYSTEM";

export interface DocumentAccessActor {
  type: DocumentActorType;
  id: string;
  permissions?: readonly string[]; // ADMIN only
}

export type DocumentDenialReason =
  | "NOT_FOUND"
  | "RESTRICTED"
  | "LEGAL_HOLD"
  | "NO_PERMISSION"
  | "NOT_OWNER"
  | "NOT_SHARED"
  | "SHARE_SCOPE"
  | "FAMILY_PERMISSION_MISSING"
  | "SOFT_DELETED"
  | "ARCHIVED";

export interface AccessDecision {
  allowed: boolean;
  reason?: DocumentDenialReason;
}

const ALLOW: AccessDecision = { allowed: true };
const deny = (reason: DocumentDenialReason): AccessDecision => ({ allowed: false, reason });

// Highly sensitive classifications need the "sensitive:*" variant of a permission, never the plain one.
const HIGH_SENSITIVITY: DocumentClassification[] = ["HIGHLY_SENSITIVE", "RESTRICTED"];

function hasAny(perms: readonly string[] | undefined, ...names: string[]): boolean {
  return names.some((n) => perms?.includes(n));
}

export interface FamilyContext {
  membershipActive: boolean;
  applicantId: string | null;
  permissionView: boolean;
  permissionComment: boolean;
  permissionDownload: boolean;
  shareActive: boolean;
  shareScope: "VIEW" | "DOWNLOAD" | null;
}

// ---------------------------------------------------------------- pure decision (unit-tested)

export function decideDocumentAccess(params: {
  actor: DocumentAccessActor;
  document: Pick<Document, "id" | "ownerType" | "ownerId" | "profileId" | "classification" | "status" | "softDeletedAt" | "archivedAt" | "typeKey" | "requestId">;
  action: DocumentAccessAction;
  restricted: boolean;
  legalHold: boolean;
  family?: FamilyContext;
  identityDocument: boolean; // this type is IDENTITY-category — needs sensitive:identity_documents:view to read
}): AccessDecision {
  const { actor, document, action, restricted, legalHold, family, identityDocument } = params;

  if (document.softDeletedAt && action !== "RESTORE" && actor.type !== "ADMIN") return deny("NOT_FOUND");
  // Quarantined files are invisible to everyone except an admin who specifically manages security scans
  // (spec §13: "never allow normal users... Authorized security/admin personnel can review").
  if (document.status === "QUARANTINED" && !(actor.type === "ADMIN" && (actor.permissions ?? []).includes("documents:manage_providers"))) return deny("NOT_FOUND");

  if (action === "DELETE" && legalHold) return deny("LEGAL_HOLD");

  if (actor.type === "SYSTEM") return ALLOW; // background jobs (retention, expiry reminders) — never end-user-triggered

  if (actor.type === "PROFILE") {
    const isOwner = document.profileId === actor.id || (document.ownerType === "PROFILE" && document.ownerId === actor.id);
    if (["VIEW", "PREVIEW", "DOWNLOAD"].includes(action)) {
      if (!isOwner) return deny("NOT_OWNER");
      return ALLOW; // an applicant may always read their own document, whatever its classification
    }
    if (action === "SHARE") {
      if (!isOwner) return deny("NOT_OWNER");
      if (restricted) return deny("RESTRICTED");
      return ALLOW; // requesting a share still goes through the sharing service's own approval gate
    }
    if (action === "DELETE") {
      // Narrow, safe self-service deletion only: their own document, not tied to a request/proposal, and
      // not already a completed verification decision — anything more significant needs staff review.
      if (!isOwner) return deny("NOT_OWNER");
      if (restricted) return deny("RESTRICTED");
      const selfServiceEligible = !document.requestId && document.status !== "VERIFIED" && document.status !== "RESTRICTED";
      return selfServiceEligible ? ALLOW : deny("NO_PERMISSION");
    }
    return deny("NO_PERMISSION"); // an applicant never reviews/verifies/rejects/redacts/exports/archives
  }

  if (actor.type === "FAMILY_MEMBER") {
    if (!family?.membershipActive) return deny("NOT_FOUND");
    if (action === "VIEW" || action === "PREVIEW") {
      if (!family.permissionView) return deny("FAMILY_PERMISSION_MISSING");
      if (!family.shareActive) return deny("NOT_SHARED"); // the permission alone is never sufficient — spec §26
      return ALLOW;
    }
    if (action === "DOWNLOAD") {
      if (!family.permissionView || !family.permissionDownload) return deny("FAMILY_PERMISSION_MISSING");
      if (!family.shareActive) return deny("NOT_SHARED");
      if (family.shareScope !== "DOWNLOAD") return deny("SHARE_SCOPE");
      return ALLOW;
    }
    return deny("NO_PERMISSION");
  }

  // ADMIN
  const perms = actor.permissions ?? [];
  const highSensitivity = HIGH_SENSITIVITY.includes(document.classification);
  switch (action) {
    case "VIEW":
    case "PREVIEW":
      return hasAny(perms, "documents:view") ? ALLOW : deny("NO_PERMISSION");
    case "DOWNLOAD": {
      if (identityDocument && !hasAny(perms, "sensitive:identity_documents:view")) return deny("NO_PERMISSION");
      const need = highSensitivity ? hasAny(perms, "sensitive:documents:download") : hasAny(perms, "documents:download");
      return need ? ALLOW : deny("NO_PERMISSION");
    }
    case "VERIFY":
    case "APPROVE":
      return hasAny(perms, "documents:verify", "verification:documents:approve") ? ALLOW : deny("NO_PERMISSION");
    case "REJECT":
      return hasAny(perms, "documents:reject", "verification:documents:reject") ? ALLOW : deny("NO_PERMISSION");
    case "SHARE": {
      const need = highSensitivity ? hasAny(perms, "sensitive:documents:share") : hasAny(perms, "documents:share");
      return need ? ALLOW : deny("NO_PERMISSION");
    }
    case "REDACT":
      return hasAny(perms, "documents:redact") ? ALLOW : deny("NO_PERMISSION");
    case "EXPORT": {
      const need = highSensitivity ? hasAny(perms, "sensitive:documents:export") : hasAny(perms, "documents:export");
      return need ? ALLOW : deny("NO_PERMISSION");
    }
    case "DELETE":
      return hasAny(perms, "documents:delete") ? ALLOW : deny("NO_PERMISSION");
    case "RESTORE":
      return hasAny(perms, "documents:restore") ? ALLOW : deny("NO_PERMISSION");
    default:
      return deny("NO_PERMISSION");
  }
}

// ---------------------------------------------------------------- DB-backed orchestration

async function loadFamilyContext(familyMemberId: string, documentId: string): Promise<FamilyContext> {
  const membership = await getFamilyMembership(familyMemberId);
  const [view, comment, download, share] = await Promise.all([
    hasFamilyPermission(familyMemberId, "document.view"),
    hasFamilyPermission(familyMemberId, "document.comment"),
    hasFamilyPermission(familyMemberId, "document.download"),
    prisma.documentShare.findFirst({ where: { documentId, recipientType: "FAMILY_MEMBER", recipientId: familyMemberId, status: { in: ["APPROVED", "ACTIVE"] } } }),
  ]);
  const shareActive = !!share && (!share.expiresAt || share.expiresAt.getTime() > Date.now()) && !share.revokedAt;
  return {
    membershipActive: !!membership,
    applicantId: membership?.applicantId ?? null,
    permissionView: view,
    permissionComment: comment,
    permissionDownload: download,
    shareActive,
    shareScope: shareActive ? (share?.scope ?? null) : null,
  };
}

export async function checkDocumentAccess(actor: DocumentAccessActor, document: Document, action: DocumentAccessAction): Promise<AccessDecision> {
  const [restricted, legalHold, typeConfig, family] = await Promise.all([
    document.profileId ? checkRestricted(document.profileId) : Promise.resolve(false),
    hasActiveHold({ recordType: "Document", recordId: document.id }),
    prisma.documentTypeConfig.findUnique({ where: { key: document.typeKey }, select: { categoryKey: true } }),
    actor.type === "FAMILY_MEMBER" ? loadFamilyContext(actor.id, document.id) : Promise.resolve(undefined),
  ]);
  return decideDocumentAccess({ actor, document, action, restricted, legalHold, family, identityDocument: typeConfig?.categoryKey === "IDENTITY" });
}

async function checkRestricted(profileId: string): Promise<boolean> {
  const [byDoc, byAccount] = await Promise.all([hasActiveRestriction(profileId, "DOCUMENT_ACCESS_RESTRICTED"), hasActiveRestriction(profileId, "FULL_ACCOUNT_RESTRICTED")]);
  return byDoc || byAccount;
}

export async function requireDocumentAccess(actor: DocumentAccessActor, document: Document, action: DocumentAccessAction): Promise<void> {
  const decision = await checkDocumentAccess(actor, document, action);
  if (!decision.allowed) {
    const { logDocumentAccess } = await import("@/lib/documents/audit-log");
    await logDocumentAccess(document.id, action, actor, "DENIED", { denialReason: decision.reason, profileId: document.profileId });
    if (decision.reason !== "NOT_FOUND" && actor.type !== "SYSTEM" && (action === "DOWNLOAD" || action === "VIEW" || action === "PREVIEW")) {
      const { publishSecurityEvent } = await import("@/lib/security/event-bus");
      await publishSecurityEvent({ eventType: "DOCUMENT_UNAUTHORIZED_ACCESS", profileId: document.profileId ?? undefined, meta: { documentId: document.id, actorType: actor.type, action, reason: decision.reason } }).catch(() => undefined);
    }
    const { HttpError } = await import("@/lib/http-error");
    throw new HttpError(decision.reason === "NOT_FOUND" ? 404 : 403, decision.reason === "NOT_FOUND" ? "Document not found." : "Forbidden: insufficient permissions");
  }
}
