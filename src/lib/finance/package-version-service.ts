import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { HttpError } from "@/lib/http-error";
import { isValidPackageVersionStatusTransition } from "@/lib/finance/status-transitions";

// STEP 27 §5 — the real "never silently change an active package"
// mechanism. Activating a version (DRAFT/PENDING_APPROVAL -> ACTIVE) is
// gated by the calling admin route via enforceApprovalGate against
// APPROVAL_CATALOG's PACKAGE_VERSION_ACTIVATION entry, never here.

export interface CreatePackageVersionInput {
  packageId: string;
  name: string;
  description: string;
  priceMinor: number;
  currencyCode: string;
  changeReason: string;
}

export async function createPackageVersion(actorId: string, input: CreatePackageVersionInput) {
  const pkg = await prisma.package.findUnique({ where: { id: input.packageId }, include: { entitlements: true } });
  if (!pkg) throw new HttpError(404, "Package not found.");

  const versionNumber = pkg.currentVersion + 1;
  const version = await prisma.packageVersion.create({
    data: {
      versionCode: await nextSequenceCode("PKGV"),
      packageId: pkg.id,
      versionNumber,
      previousVersion: pkg.currentVersion,
      name: input.name,
      description: input.description,
      packageType: pkg.packageType,
      priceMinor: input.priceMinor,
      currencyCode: input.currencyCode,
      featuresSnapshot: pkg.entitlements.map((e) => ({ featureKey: e.featureKey, limitValue: e.limitValue, resetPeriod: e.resetPeriod })),
      limitsSnapshot: pkg.entitlements.map((e) => ({ featureKey: e.featureKey, limitValue: e.limitValue })),
      changeReason: input.changeReason,
      status: "DRAFT",
      createdById: actorId,
    },
  });
  await writeAudit({ action: "PACKAGE_VERSION_CREATED", adminId: actorId, meta: { packageId: pkg.id, versionId: version.id, versionNumber } });
  return version;
}

// Plain DB mutation for a status move; the maker-checker gate for the
// DRAFT/PENDING_APPROVAL -> ACTIVE edge lives in the calling admin route.
export async function setPackageVersionStatus(actorId: string, versionId: string, status: "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "REJECTED", approvedById?: string) {
  const version = await prisma.packageVersion.findUnique({ where: { id: versionId } });
  if (!version) throw new HttpError(404, "Package version not found.");
  if (!isValidPackageVersionStatusTransition(version.status, status)) throw new HttpError(422, `Cannot move a package version from ${version.status} to ${status}.`);

  if (status === "ACTIVE") {
    return prisma.$transaction(async (tx) => {
      // Supersede the package's currently-ACTIVE version, if any — only one
      // version is ACTIVE at a time.
      await tx.packageVersion.updateMany({ where: { packageId: version.packageId, status: "ACTIVE" }, data: { status: "SUPERSEDED" } });
      const updated = await tx.packageVersion.update({ where: { id: versionId }, data: { status: "ACTIVE", approvedById: approvedById ?? version.approvedById, effectiveAt: new Date() } });
      await tx.package.update({ where: { id: version.packageId }, data: { currentVersion: updated.versionNumber } });
      await writeAudit({ action: "PACKAGE_VERSION_ACTIVATED", adminId: actorId, meta: { packageId: version.packageId, versionId, versionNumber: updated.versionNumber } });
      return updated;
    });
  }

  const updated = await prisma.packageVersion.update({ where: { id: versionId }, data: { status } });
  await writeAudit({ action: "PACKAGE_VERSION_CREATED", adminId: actorId, meta: { packageId: version.packageId, versionId, status } });
  return updated;
}

export async function listPackageVersions(packageId: string) {
  return prisma.packageVersion.findMany({ where: { packageId }, orderBy: { versionNumber: "desc" } });
}
