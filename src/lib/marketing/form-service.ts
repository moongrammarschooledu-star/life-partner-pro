import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { marketingAudit } from "@/lib/marketing/audit";
import { assertApprovedPayloadMatches, gateMarketingAction } from "@/lib/marketing/approval";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { canTransitionContentVersion } from "@/lib/marketing/constants";
import { scanMarketingContent } from "@/lib/marketing/content-policy";
import { contentHashOf } from "@/lib/marketing/landing-schema";
import { parseFormDefinition, type ConsentConfig, type FormFieldDef } from "@/lib/marketing/form-schema";
import type { SessionAdmin } from "@/lib/route-guard";
import type { LeadForm, LeadFormVersion } from "@prisma/client";

// STEP 29 §12 — lead forms: versioned like landing pages. A form version pins the privacy-notice version it shows, so
// every submission's consent evidence can say exactly which notice and which wording the person saw.

export const STATIC_PRIVACY_NOTICE = "STATIC_PRIVACY_POLICY"; // the app's own /privacy-policy page

export async function resolvePrivacyNoticeVersion(id: string): Promise<string> {
  if (id === STATIC_PRIVACY_NOTICE) return id;
  const doc = await prisma.legalDocumentVersion.findUnique({ where: { id }, select: { id: true, documentType: true, approvalStatus: true } });
  if (!doc || doc.approvalStatus !== "PUBLISHED" || (doc.documentType !== "PRIVACY_POLICY" && doc.documentType !== "CONSENT_NOTICE")) {
    throw new HttpError(422, "The privacy notice must be a published privacy-policy/consent-notice version (or the site's own privacy policy page).");
  }
  return doc.id;
}

export interface FormContentInput {
  fields: unknown;
  consentConfig: unknown;
  privacyNoticeVersionId: string;
  changeSummary?: string | null;
}

async function normalize(input: FormContentInput) {
  const def = parseFormDefinition(input.fields, input.consentConfig);
  const privacyNoticeVersionId = await resolvePrivacyNoticeVersion(input.privacyNoticeVersionId);
  const contentHash = contentHashOf({ f: def.fields, c: def.consentConfig, p: privacyNoticeVersionId });
  return { ...def, privacyNoticeVersionId, contentHash, changeSummary: input.changeSummary?.trim().slice(0, 300) || null };
}

function scanForm(fields: FormFieldDef[], consent: ConsentConfig) {
  return scanMarketingContent({
    texts: [
      ...fields.map((f) => ({ field: `field.${f.key}`, text: f.label })),
      { field: "consent.inquiryContact", text: consent.inquiryContact.text },
      ...(consent.marketingUpdates.text ? [{ field: "consent.marketingUpdates", text: consent.marketingUpdates.text }] : []),
      ...(consent.whatsapp.text ? [{ field: "consent.whatsapp", text: consent.whatsapp.text }] : []),
    ],
    // Consent wording legitimately links to nothing; the notice link is rendered by the form from the pinned version.
    requiredDisclosures: { privacyNotice: true, consentBlock: true, disclaimer: true },
  });
}

export async function createLeadForm(actor: SessionAdmin, input: FormContentInput & { name: string; campaignId?: string | null }) {
  const name = input.name.trim();
  if (!name || name.length > 120 || /[<>]/.test(name)) throw new HttpError(422, "A valid name is required.");
  const n = await normalize(input);
  const code = await nextSequenceCode("FORM");
  const form = await prisma.leadForm.create({
    data: {
      code, name, campaignId: input.campaignId ?? null, createdById: actor.id,
      versions: { create: { version: 1, status: "DRAFT", fields: n.fields as never, consentConfig: n.consentConfig as never, privacyNoticeVersionId: n.privacyNoticeVersionId, contentHash: n.contentHash, changeSummary: n.changeSummary, authorId: actor.id } },
    },
    include: { versions: true },
  });
  await marketingAudit({ action: "MARKETING_FORM_VERSION_CREATED", actorId: actor.id, resource: "lead_form", resourceId: form.id, after: { code, version: 1 } });
  return form;
}

async function loadVersion(formId: string, version: number): Promise<{ form: LeadForm; v: LeadFormVersion }> {
  const form = await prisma.leadForm.findUnique({ where: { id: formId } });
  if (!form) throw new HttpError(404, "Form not found.");
  const v = await prisma.leadFormVersion.findUnique({ where: { formId_version: { formId, version } } });
  if (!v) throw new HttpError(404, "Version not found.");
  return { form, v };
}

export async function saveFormDraft(actor: SessionAdmin, formId: string, input: FormContentInput): Promise<LeadFormVersion> {
  const form = await prisma.leadForm.findUnique({ where: { id: formId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!form) throw new HttpError(404, "Form not found.");
  if (form.status === "ARCHIVED") throw new HttpError(409, "An archived form cannot be edited.");
  const n = await normalize(input);
  const data = { fields: n.fields as never, consentConfig: n.consentConfig as never, privacyNoticeVersionId: n.privacyNoticeVersionId, contentHash: n.contentHash, changeSummary: n.changeSummary };
  const latest = form.versions[0];
  if (latest && (latest.status === "DRAFT" || latest.status === "REJECTED")) {
    const updated = await prisma.leadFormVersion.update({ where: { id: latest.id }, data: { ...data, status: "DRAFT", authorId: actor.id, reviewerId: null, reviewedAt: null } });
    await marketingAudit({ action: "MARKETING_FORM_VERSION_CREATED", actorId: actor.id, resource: "lead_form", resourceId: formId, after: { version: updated.version, edited: true } });
    return updated;
  }
  const created = await prisma.leadFormVersion.create({ data: { formId, version: (latest?.version ?? 0) + 1, status: "DRAFT", ...data, authorId: actor.id } });
  await marketingAudit({ action: "MARKETING_FORM_VERSION_CREATED", actorId: actor.id, resource: "lead_form", resourceId: formId, after: { version: created.version } });
  return created;
}

export async function submitFormVersion(actor: SessionAdmin, formId: string, version: number) {
  const { v } = await loadVersion(formId, version);
  if (!canTransitionContentVersion(v.status, "REVIEW")) throw new HttpError(409, `A ${v.status.toLowerCase()} version cannot be submitted for review.`);
  const def = parseFormDefinition(v.fields, v.consentConfig);
  const scan = scanForm(def.fields, def.consentConfig);
  if (!scan.pass) {
    await marketingAudit({ action: "MARKETING_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "lead_form", resourceId: formId, extra: { version, rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This form conflicts with the marketing content policy."), { findings: scan.findings });
  }
  return prisma.leadFormVersion.update({ where: { id: v.id }, data: { status: "REVIEW" } });
}

export async function reviewFormVersion(actor: SessionAdmin, formId: string, version: number, decision: "APPROVE" | "REJECT", note?: string) {
  const { v } = await loadVersion(formId, version);
  if (v.status !== "REVIEW") throw new HttpError(409, "Only a version in review can be decided.");
  if (v.authorId === actor.id) throw new HttpError(403, "You cannot review a version you authored.");
  if (decision === "APPROVE") {
    const def = parseFormDefinition(v.fields, v.consentConfig);
    const scan = scanForm(def.fields, def.consentConfig);
    if (!scan.pass) throw Object.assign(new HttpError(422, "This form no longer passes the marketing content policy."), { findings: scan.findings });
  }
  const updated = await prisma.leadFormVersion.update({ where: { id: v.id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewerId: actor.id, reviewedAt: new Date() } });
  await marketingAudit({ action: "MARKETING_FORM_VERSION_CREATED", actorId: actor.id, resource: "lead_form", resourceId: formId, after: { version, status: updated.status }, reason: note });
  return updated;
}

export type FormPublishOutcome = { approvalRequired: false; version: LeadFormVersion } | { approvalRequired: true; approvalCode: string; status: string };

export async function publishFormVersion(actor: SessionAdmin, formId: string, version: number, reason: string): Promise<FormPublishOutcome> {
  const { form, v } = await loadVersion(formId, version);
  if (form.status === "ARCHIVED") throw new HttpError(409, "An archived form cannot be published.");
  if (v.status !== "APPROVED") throw new HttpError(409, "Only an approved version can be published.");
  await resolvePrivacyNoticeVersion(v.privacyNoticeVersionId); // the pinned notice must still be valid at publish time

  const gate = await gateMarketingAction({ actionType: "MARKETING_LANDING_PAGE_PUBLISH", sourceId: `form:${formId}:v${version}`, actor, reason, requestedPayload: { formId, version, contentHash: v.contentHash } });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) await assertApprovedPayloadMatches(gate.approvalRequestId, { formId, version, contentHash: v.contentHash });

  const published = await prisma.$transaction(async (tx) => {
    if (form.publishedVersionId && form.publishedVersionId !== v.id) await tx.leadFormVersion.update({ where: { id: form.publishedVersionId }, data: { status: "SUPERSEDED" } });
    await tx.leadForm.update({ where: { id: formId }, data: { status: "PUBLISHED", publishedVersionId: v.id } });
    return tx.leadFormVersion.update({ where: { id: v.id }, data: { publishedAt: new Date() } });
  });
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_FORM_PUBLISHED", actorId: actor.id, resource: "lead_form", resourceId: formId, before: { publishedVersionId: form.publishedVersionId }, after: { publishedVersionId: v.id, version }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, version: published };
}

export async function unpublishForm(actor: SessionAdmin, formId: string, reason: string): Promise<LeadForm> {
  const form = await prisma.leadForm.findUnique({ where: { id: formId } });
  if (!form) throw new HttpError(404, "Form not found.");
  if (form.status !== "PUBLISHED") throw new HttpError(409, "The form is not published.");
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const updated = await prisma.leadForm.update({ where: { id: formId }, data: { status: "UNPUBLISHED" } });
  await marketingAudit({ action: "MARKETING_FORM_PUBLISHED", actorId: actor.id, resource: "lead_form", resourceId: formId, before: { status: "PUBLISHED" }, after: { status: "UNPUBLISHED" }, reason });
  return updated;
}

export async function getPublishedForm(formId: string): Promise<{ form: LeadForm; version: LeadFormVersion; fields: FormFieldDef[]; consentConfig: ConsentConfig } | null> {
  const form = await prisma.leadForm.findUnique({ where: { id: formId } });
  if (!form || form.status !== "PUBLISHED" || !form.publishedVersionId) return null;
  const version = await prisma.leadFormVersion.findUnique({ where: { id: form.publishedVersionId } });
  if (!version || version.status !== "APPROVED" || !version.publishedAt) return null;
  const def = parseFormDefinition(version.fields, version.consentConfig);
  return { form, version, fields: def.fields, consentConfig: def.consentConfig };
}
