import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { writeAudit } from "@/lib/audit";
import type { DocumentClassification } from "@prisma/client";

// The admin-editable category/type catalog (spec §2/§3) — never a Prisma enum, so a new category or
// document type never needs a migration or a code deploy. Nothing here treats any type as universally
// mandatory; that decision belongs to whatever feature requests a document (e.g. the STEP 8/23
// verification checklist, or a DocumentRequest), never to this catalog.

export const DEFAULT_CATEGORIES: Array<{ key: string; label: string; defaultClassification: DocumentClassification }> = [
  { key: "IDENTITY", label: "Identity", defaultClassification: "RESTRICTED" },
  { key: "PROFILE", label: "Profile", defaultClassification: "CONFIDENTIAL" },
  { key: "EDUCATION", label: "Education", defaultClassification: "CONFIDENTIAL" },
  { key: "EMPLOYMENT", label: "Employment", defaultClassification: "CONFIDENTIAL" },
  { key: "INCOME", label: "Income", defaultClassification: "HIGHLY_SENSITIVE" },
  { key: "FAMILY", label: "Family", defaultClassification: "CONFIDENTIAL" },
  { key: "ADDRESS", label: "Address", defaultClassification: "CONFIDENTIAL" },
  { key: "VERIFICATION", label: "Verification", defaultClassification: "RESTRICTED" },
  { key: "LEGAL", label: "Legal", defaultClassification: "HIGHLY_SENSITIVE" },
  { key: "PAYMENT", label: "Payment", defaultClassification: "HIGHLY_SENSITIVE" },
  { key: "SUPPORT", label: "Support", defaultClassification: "CONFIDENTIAL" },
  { key: "SAFETY", label: "Safety", defaultClassification: "RESTRICTED" },
  { key: "PRIVACY", label: "Privacy", defaultClassification: "RESTRICTED" },
  { key: "COMPLIANCE", label: "Compliance", defaultClassification: "HIGHLY_SENSITIVE" },
  { key: "AGREEMENT", label: "Agreement", defaultClassification: "CONFIDENTIAL" },
  { key: "CONSENT", label: "Consent", defaultClassification: "INTERNAL" },
  { key: "MEETING", label: "Meeting", defaultClassification: "INTERNAL" },
  { key: "ADMINISTRATIVE", label: "Administrative", defaultClassification: "INTERNAL" },
  { key: "OTHER", label: "Other", defaultClassification: "RESTRICTED" },
];

// Pakistan-specific documents (e.g. CNIC) appear here as ONE configurable type among several — never
// hard-coded as universally mandatory (spec §3/§18's explicit instruction).
export const DEFAULT_TYPES: Array<{ key: string; label: string; categoryKey: string; requiresExpiry?: boolean }> = [
  { key: "PASSPORT", label: "Passport", categoryKey: "IDENTITY", requiresExpiry: true },
  { key: "NATIONAL_ID", label: "National ID", categoryKey: "IDENTITY", requiresExpiry: true },
  { key: "CNIC", label: "CNIC", categoryKey: "IDENTITY", requiresExpiry: true },
  { key: "DRIVING_LICENSE", label: "Driving License", categoryKey: "IDENTITY", requiresExpiry: true },
  { key: "EDUCATIONAL_CERTIFICATE", label: "Educational Certificate", categoryKey: "EDUCATION" },
  { key: "DEGREE", label: "Degree", categoryKey: "EDUCATION" },
  { key: "EMPLOYMENT_LETTER", label: "Employment Letter", categoryKey: "EMPLOYMENT" },
  { key: "INCOME_DOCUMENT", label: "Income Document", categoryKey: "INCOME" },
  { key: "BUSINESS_DOCUMENT", label: "Business Document", categoryKey: "EMPLOYMENT" },
  { key: "ADDRESS_DOCUMENT", label: "Address Document", categoryKey: "ADDRESS" },
  { key: "VERIFICATION_DOCUMENT", label: "Verification Document", categoryKey: "VERIFICATION" },
  { key: "CONSENT_FORM", label: "Consent Form", categoryKey: "CONSENT" },
  { key: "AGREEMENT", label: "Agreement", categoryKey: "AGREEMENT" },
  { key: "SUPPORT_EVIDENCE", label: "Support Evidence", categoryKey: "SUPPORT" },
  { key: "ADMINISTRATIVE_DOCUMENT", label: "Administrative Document", categoryKey: "ADMINISTRATIVE" },
  { key: "OTHER", label: "Other", categoryKey: "OTHER" },
];

// Idempotent seed — only inserts rows that don't already exist, so re-running never overwrites an
// admin's own edits (mirrors seedDefaultWorkflowRules()/seedApprovalPolicies()'s exact pattern).
export async function seedDocumentCatalog(): Promise<void> {
  for (const c of DEFAULT_CATEGORIES) {
    await prisma.documentCategoryConfig.upsert({ where: { key: c.key }, update: {}, create: c });
  }
  for (const t of DEFAULT_TYPES) {
    await prisma.documentTypeConfig.upsert({ where: { key: t.key }, update: {}, create: { ...t, requiresExpiry: t.requiresExpiry ?? false } });
  }
}

export async function listCategories(activeOnly = true) {
  return prisma.documentCategoryConfig.findMany({ where: activeOnly ? { active: true } : undefined, orderBy: { label: "asc" }, include: { types: activeOnly ? { where: { active: true } } : true } });
}

export async function getTypeConfig(typeKey: string) {
  const type = await prisma.documentTypeConfig.findUnique({ where: { key: typeKey }, include: { category: true } });
  if (!type || !type.active) throw new HttpError(422, "Unknown or inactive document type.");
  return type;
}

export interface CategoryInput {
  key: string;
  label: string;
  defaultClassification?: DocumentClassification;
}
export interface TypeInput {
  key: string;
  label: string;
  categoryKey: string;
  defaultClassification?: DocumentClassification;
  requiresExpiry?: boolean;
  acceptedMimeTypes?: string[];
}

const KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,49}$/;

export async function createCategory(actorId: string, input: CategoryInput) {
  if (!KEY_PATTERN.test(input.key)) throw new HttpError(422, "Category key must be UPPER_SNAKE_CASE.");
  if (input.label.trim().length < 2) throw new HttpError(422, "A label is required.");
  const created = await prisma.documentCategoryConfig.create({ data: { key: input.key, label: input.label.trim(), defaultClassification: input.defaultClassification ?? "RESTRICTED" } });
  await writeAudit({ action: "DOCUMENT_TYPE_CONFIG_CHANGED", adminId: actorId, meta: { kind: "CATEGORY", key: input.key, change: "CREATED" } });
  return created;
}

export async function createType(actorId: string, input: TypeInput) {
  if (!KEY_PATTERN.test(input.key)) throw new HttpError(422, "Type key must be UPPER_SNAKE_CASE.");
  if (input.label.trim().length < 2) throw new HttpError(422, "A label is required.");
  const category = await prisma.documentCategoryConfig.findUnique({ where: { key: input.categoryKey } });
  if (!category) throw new HttpError(422, "Unknown category.");
  const created = await prisma.documentTypeConfig.create({
    data: {
      key: input.key,
      label: input.label.trim(),
      categoryKey: input.categoryKey,
      defaultClassification: input.defaultClassification ?? category.defaultClassification,
      requiresExpiry: input.requiresExpiry ?? false,
      acceptedMimeTypes: JSON.stringify(input.acceptedMimeTypes ?? []),
      createdById: actorId,
    },
  });
  await writeAudit({ action: "DOCUMENT_TYPE_CONFIG_CHANGED", adminId: actorId, meta: { kind: "TYPE", key: input.key, change: "CREATED", categoryKey: input.categoryKey } });
  return created;
}

export async function setTypeActive(actorId: string, key: string, active: boolean) {
  const updated = await prisma.documentTypeConfig.update({ where: { key }, data: { active } });
  await writeAudit({ action: "DOCUMENT_TYPE_CONFIG_CHANGED", adminId: actorId, meta: { kind: "TYPE", key, change: active ? "ACTIVATED" : "DEACTIVATED" } });
  return updated;
}
