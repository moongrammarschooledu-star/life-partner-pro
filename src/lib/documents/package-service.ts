import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { SessionAdmin } from "@/lib/route-guard";
import type { DocumentOwnerType } from "@prisma/client";
import { checkDocumentAccess } from "@/lib/documents/access-service";

// DocumentPackageService (spec §51). A package is a PERMISSION/CONSENT/HOLD-CHECKED MANIFEST, not a real
// .zip file — no zip dependency exists in this repo and bundling encrypted, per-document keys into one
// archive would need one; each item instead resolves to its own signed access ticket when actually
// fetched (see access-tokens.ts), so nothing is ever exported in bulk without every individual document
// re-passing its own access check at fetch time.

export interface CreatePackageInput {
  kind: "VERIFICATION" | "PROPOSAL" | "SUPPORT_CASE" | "COMPLIANCE";
  ownerType: DocumentOwnerType;
  ownerId: string;
  purpose: string;
  documentIds: string[];
  expiresAt?: Date | null;
}

export async function createPackage(actor: SessionAdmin, input: CreatePackageInput) {
  if (!input.purpose.trim()) throw new HttpError(422, "A purpose is required.");
  if (input.documentIds.length === 0) throw new HttpError(422, "At least one document is required.");
  if (!actor.permissions.includes("documents:export")) throw new HttpError(403, "Forbidden: insufficient permissions");

  const documents = await prisma.document.findMany({ where: { id: { in: input.documentIds } } });
  const packageCode = await nextSequenceCode("DOCPKG");
  const pkg = await prisma.documentPackage.create({ data: { packageCode, kind: input.kind, ownerType: input.ownerType, ownerId: input.ownerId, createdById: actor.id, purpose: input.purpose.trim().slice(0, 300), expiresAt: input.expiresAt ?? null } });

  const items: Array<{ packageId: string; documentId: string; included: boolean; excludeReason: string | null }> = [];
  for (const documentId of input.documentIds) {
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) {
      items.push({ packageId: pkg.id, documentId, included: false, excludeReason: "NOT_FOUND" });
      continue;
    }
    const decision = await checkDocumentAccess({ type: "ADMIN", id: actor.id, permissions: actor.permissions }, doc, "EXPORT");
    items.push({ packageId: pkg.id, documentId, included: decision.allowed, excludeReason: decision.allowed ? null : decision.reason ?? "NO_PERMISSION" });
  }
  await prisma.documentPackageItem.createMany({ data: items });
  await writeAudit({ action: "DOCUMENT_PACKAGE_CREATED", adminId: actor.id, meta: { packageId: pkg.id, packageCode, kind: input.kind, requested: input.documentIds.length, included: items.filter((i) => i.included).length } });
  return getPackage(pkg.id);
}

export async function getPackage(packageId: string) {
  const pkg = await prisma.documentPackage.findUnique({ where: { id: packageId }, include: { items: true } });
  if (!pkg) throw new HttpError(404, "Package not found.");
  return pkg;
}

export async function listPackages(ownerType?: DocumentOwnerType, ownerId?: string) {
  return prisma.documentPackage.findMany({ where: { ...(ownerType ? { ownerType } : {}), ...(ownerId ? { ownerId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
}
