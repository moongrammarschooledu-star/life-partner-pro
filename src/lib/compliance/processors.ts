import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import type { SessionAdmin } from "@/lib/route-guard";

// Provider register (plan decision 8) — an admin manually records each real
// third-party processor. Deliberately never auto-populated from existing
// technical config (PaymentProviderName/OtpChannel/AI-provider settings):
// auto-generating rows from a technical integration would misrepresent an
// unreviewed processor as reviewed. complianceStatus always starts at
// REVIEW_REQUIRED and is only ever changed by an explicit reviewer action
// (recordProcessorReview) — never inferred from a security certification.

export interface CreateProcessorInput {
  name: string;
  serviceType: string;
  legalEntity?: string;
  country: string;
  processingRegions: string[];
  dataTypes: string[];
  subprocessors?: string[];
  transferMechanism?: string;
}

export async function createProcessor(input: CreateProcessorInput, actor: SessionAdmin) {
  const processor = await prisma.complianceProcessor.create({
    data: {
      processorCode: await nextSequenceCode("PROC"),
      name: input.name,
      serviceType: input.serviceType,
      legalEntity: input.legalEntity ?? null,
      country: input.country,
      processingRegions: JSON.stringify(input.processingRegions),
      dataTypes: JSON.stringify(input.dataTypes),
      subprocessors: input.subprocessors ? JSON.stringify(input.subprocessors) : null,
      transferMechanism: input.transferMechanism ?? null,
      contractStatus: "NOT_RECORDED",
      complianceStatus: "REVIEW_REQUIRED",
    },
  });

  await writeAudit({ action: "PROCESSOR_CREATED", adminId: actor.id, meta: { processorId: processor.id, processorCode: processor.processorCode } });
  return processor;
}

export async function updateProcessor(processorId: string, patch: Partial<CreateProcessorInput> & { contractStatus?: string }, actor: SessionAdmin) {
  const processor = await prisma.complianceProcessor.update({
    where: { id: processorId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.serviceType !== undefined && { serviceType: patch.serviceType }),
      ...(patch.legalEntity !== undefined && { legalEntity: patch.legalEntity }),
      ...(patch.country !== undefined && { country: patch.country }),
      ...(patch.processingRegions !== undefined && { processingRegions: JSON.stringify(patch.processingRegions) }),
      ...(patch.dataTypes !== undefined && { dataTypes: JSON.stringify(patch.dataTypes) }),
      ...(patch.subprocessors !== undefined && { subprocessors: JSON.stringify(patch.subprocessors) }),
      ...(patch.transferMechanism !== undefined && { transferMechanism: patch.transferMechanism }),
      ...(patch.contractStatus !== undefined && { contractStatus: patch.contractStatus }),
    },
  });

  await writeAudit({ action: "PROCESSOR_CREATED", adminId: actor.id, meta: { processorId, updated: true } });
  return processor;
}

// The one place complianceStatus may change — always an explicit reviewer
// decision, carrying its own note in audit meta (spec §52's "review, not
// inference" requirement). Never called automatically from a webhook/cert check.
export async function recordProcessorReview(processorId: string, complianceStatus: string, actor: SessionAdmin, note: string, nextReviewDue?: Date) {
  const processor = await prisma.complianceProcessor.update({
    where: { id: processorId },
    data: { complianceStatus, lastReviewedAt: new Date(), nextReviewDue: nextReviewDue ?? null },
  });

  await writeAudit({ action: "PROCESSOR_REVIEWED", adminId: actor.id, meta: { processorId, complianceStatus, note } });
  return processor;
}

export async function listProcessors(filter?: { serviceType?: string; complianceStatus?: string }) {
  return prisma.complianceProcessor.findMany({
    where: {
      ...(filter?.serviceType && { serviceType: filter.serviceType }),
      ...(filter?.complianceStatus && { complianceStatus: filter.complianceStatus }),
    },
    orderBy: { name: "asc" },
  });
}

export async function getProcessor(processorId: string) {
  return prisma.complianceProcessor.findUnique({ where: { id: processorId }, include: { agreements: true } });
}

// Due-list mirroring listRulesDueForReview (rules.ts) for the same admin
// "Reviews" surface.
export async function listProcessorsDueForReview(asOf: Date = new Date()) {
  return prisma.complianceProcessor.findMany({
    where: { nextReviewDue: { lte: asOf } },
    orderBy: { nextReviewDue: "asc" },
  });
}

export interface CreateAgreementInput {
  processorId: string;
  agreementType: string;
  effectiveDate?: Date;
  expiryDate?: Date;
  jurisdictionId?: string;
  dataCategories: string[];
  subprocessorTerms?: string;
  securityTerms?: string;
  transferTerms?: string;
}

export async function createAgreement(input: CreateAgreementInput, actor: SessionAdmin) {
  const agreement = await prisma.processorAgreement.create({
    data: {
      agreementCode: await nextSequenceCode("AGRMT"),
      processorId: input.processorId,
      agreementType: input.agreementType,
      agreementStatus: "DRAFT",
      effectiveDate: input.effectiveDate ?? null,
      expiryDate: input.expiryDate ?? null,
      jurisdictionId: input.jurisdictionId ?? null,
      dataCategories: JSON.stringify(input.dataCategories),
      subprocessorTerms: input.subprocessorTerms ?? null,
      securityTerms: input.securityTerms ?? null,
      transferTerms: input.transferTerms ?? null,
    },
  });

  await writeAudit({ action: "PROCESSOR_AGREEMENT_RECORDED", adminId: actor.id, meta: { agreementId: agreement.id, agreementCode: agreement.agreementCode, processorId: input.processorId } });
  return agreement;
}

export async function approveAgreement(agreementId: string, actor: SessionAdmin) {
  const agreement = await prisma.processorAgreement.update({
    where: { id: agreementId },
    data: { agreementStatus: "APPROVED", approvedById: actor.id },
  });

  await writeAudit({ action: "PROCESSOR_AGREEMENT_RECORDED", adminId: actor.id, meta: { agreementId, approved: true } });
  return agreement;
}

export async function listAgreementsForProcessor(processorId: string) {
  return prisma.processorAgreement.findMany({ where: { processorId }, orderBy: { createdAt: "desc" } });
}
