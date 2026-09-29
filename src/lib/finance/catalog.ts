import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import type { FeatureLimitType } from "@prisma/client";

// The admin-editable feature catalog (STEP 27 §6) — never a Prisma enum, so a
// new feature never needs a migration or a code deploy. PackageEntitlement.
// featureKey stays free-text; this module is what gives it real validation.
// Mirrors src/lib/documents/catalog.ts's exact pattern.

export const DEFAULT_FEATURES: Array<{ key: string; label: string; category: string; usageLimitType?: FeatureLimitType }> = [
  { key: "PROFILE_CREATE", label: "Create Profile", category: "Profile" },
  { key: "PROFILE_EDIT", label: "Edit Profile", category: "Profile", usageLimitType: "PER_MONTH" },
  { key: "PROFILE_PHOTO", label: "Profile Photos", category: "Profile" },
  { key: "PROFILE_VERIFICATION", label: "Profile Verification", category: "Verification" },
  { key: "MATCHING", label: "Matching", category: "Matching" },
  { key: "MATCH_SEARCH", label: "Match Search", category: "Matching", usageLimitType: "PER_MONTH" },
  { key: "PROPOSAL_RECEIVE", label: "Receive Proposals", category: "Proposals" },
  { key: "PROPOSAL_RESPOND", label: "Respond to Proposals", category: "Proposals" },
  { key: "MEETING_REQUEST", label: "Request Meetings", category: "Meetings" },
  { key: "FAMILY_ACCESS", label: "Family Access", category: "Family" },
  { key: "SUPPORT_PRIORITY", label: "Priority Support", category: "Support" },
  { key: "DOCUMENT_UPLOAD", label: "Document Upload", category: "Documents" },
  { key: "DOCUMENT_VERIFICATION", label: "Document Verification", category: "Documents" },
  { key: "CONTACT_REQUEST", label: "Contact Requests", category: "Contact" },
  { key: "CONTACT_APPROVAL", label: "Contact Approval", category: "Contact" },
  { key: "AI_ASSISTANCE", label: "AI Assistance", category: "AI", usageLimitType: "PER_MONTH" },
  { key: "ADVANCED_SEARCH", label: "Advanced Search", category: "Matching", usageLimitType: "PER_MONTH" },
  { key: "ADMIN_ASSISTED_MATCHMAKING", label: "Admin-Assisted Matchmaking", category: "Support", usageLimitType: "PER_MONTH" },
  { key: "REPORT_ACCESS", label: "Report Access", category: "Reports" },
];

// Idempotent seed — only inserts rows that don't already exist, so re-running
// never overwrites an admin's own edits (mirrors seedDocumentCatalog()).
export async function seedFeatureCatalog(): Promise<void> {
  for (const f of DEFAULT_FEATURES) {
    await prisma.featureDefinition.upsert({
      where: { key: f.key },
      update: {},
      create: { key: f.key, label: f.label, category: f.category, usageLimitType: f.usageLimitType ?? "UNLIMITED" },
    });
  }
}

export async function listFeatures(activeOnly = true) {
  return prisma.featureDefinition.findMany({ where: activeOnly ? { active: true } : undefined, orderBy: [{ category: "asc" }, { label: "asc" }] });
}

export async function getFeatureDefinition(key: string) {
  return prisma.featureDefinition.findUnique({ where: { key } });
}

export async function isKnownFeatureKey(key: string): Promise<boolean> {
  const def = await prisma.featureDefinition.findUnique({ where: { key } });
  return !!def && def.active;
}

// Every write path that creates/updates a PackageEntitlement calls this —
// rejects an unknown/inactive key with a clear error rather than silently
// accepting a typo that would never resolve to anything at check time.
export async function assertKnownFeatureKey(key: string): Promise<void> {
  if (!(await isKnownFeatureKey(key))) throw new HttpError(422, `Unknown or inactive feature key: ${key}`);
}

const KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,49}$/;

export interface FeatureDefinitionInput {
  key: string;
  label: string;
  description?: string;
  category?: string;
  usageLimitType?: FeatureLimitType;
}

export async function createFeatureDefinition(actorId: string, input: FeatureDefinitionInput) {
  if (!KEY_PATTERN.test(input.key)) throw new HttpError(422, "Feature key must be UPPER_SNAKE_CASE.");
  if (input.label.trim().length < 2) throw new HttpError(422, "A label is required.");
  const created = await prisma.featureDefinition.create({
    data: {
      key: input.key,
      label: input.label.trim(),
      description: input.description,
      category: input.category,
      usageLimitType: input.usageLimitType ?? "UNLIMITED",
      createdById: actorId,
    },
  });
  await writeAudit({ action: "FEATURE_DEFINITION_CHANGED", adminId: actorId, meta: { key: input.key, change: "CREATED" } });
  return created;
}

export async function setFeatureActive(actorId: string, key: string, active: boolean) {
  const updated = await prisma.featureDefinition.update({ where: { key }, data: { active } });
  await writeAudit({ action: "FEATURE_DEFINITION_CHANGED", adminId: actorId, meta: { key, change: active ? "ACTIVATED" : "DEACTIVATED" } });
  return updated;
}
