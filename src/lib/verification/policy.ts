import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

// Versioned, admin-configurable verification policy (spec §33) — mirrors
// ApprovalPolicy's (STEP 19) never-overwrite-in-place pattern: setPolicy()
// always creates a new version row rather than mutating one, so the
// effective-date/audit trail the spec requires falls out of the model shape
// itself (see plan decision 9).

export async function getEffectivePolicy<T>(policyKey: string, defaultValue: T): Promise<T> {
  const now = new Date();
  const row = await prisma.verificationPolicy.findFirst({
    where: { policyKey, status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    orderBy: { policyVersion: "desc" },
  });
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.configuration) as T;
  } catch {
    return defaultValue;
  }
}

export async function setPolicy(policyKey: string, configuration: unknown, adminId: string) {
  const latest = await prisma.verificationPolicy.findFirst({ where: { policyKey }, orderBy: { policyVersion: "desc" } });
  const nextVersion = (latest?.policyVersion ?? 0) + 1;

  const ops = [];
  if (latest && latest.status === "ACTIVE") {
    ops.push(prisma.verificationPolicy.update({ where: { id: latest.id }, data: { status: "SUPERSEDED", effectiveTo: new Date() } }));
  }
  ops.push(
    prisma.verificationPolicy.create({
      data: { policyKey, policyVersion: nextVersion, configuration: JSON.stringify(configuration), status: "ACTIVE", createdById: adminId },
    })
  );

  const results = await prisma.$transaction(ops);
  const created = results[results.length - 1];

  await writeAudit({ action: "VERIFICATION_POLICY_CHANGED", adminId, meta: { policyKey, policyVersion: nextVersion } });
  return created;
}

export async function listPolicyHistory(policyKey: string) {
  return prisma.verificationPolicy.findMany({ where: { policyKey }, orderBy: { policyVersion: "desc" } });
}

// Default values used whenever no VerificationPolicy row exists yet for a
// key — safe, disabled-by-default per spec §60's own env defaults.
export const POLICY_DEFAULTS = {
  "identityVerification.enabled": false,
  "documentVerification.enabled": true, // the existing STEP 8 manual-document-review path, already live
  "duplicateDetection.enabled": true, // the existing STEP 8 scan, already live
  "riskSignals.enabled": true,
  "reverification.enabled": true,
  "reverification.intervalDays": 365,
  "requiredVerificationLevel": 2,
} as const;
