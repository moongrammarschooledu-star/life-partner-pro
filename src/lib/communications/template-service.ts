import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/default-templates";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CommunicationMessageType, CommunicationPurpose, CommunicationTemplate, CommunicationTemplateVersion, Locale, NotificationChannel } from "@prisma/client";
import { ALLOWED_PURPOSES, describeNotification } from "@/lib/communications/classify";
import { COMMUNICATION_VARIABLES, findUrls, sanitizeUrl, validateTemplateText } from "@/lib/communications/secure-renderer";

// Template lifecycle (spec §11-§13): DRAFT -> UNDER_REVIEW -> APPROVED -> ACTIVE, and DISABLED / ARCHIVED.
//   - every content change after a version has been submitted creates a NEW version (an ACTIVE version is never edited in place);
//   - the approver can never be the person who wrote that version (no self-approval);
//   - activating an external-facing or marketing template goes through the STEP 19 gate;
//   - historical messages keep the template id + version they were sent with.
// The Template row mirrors the ACTIVE version's content for fast lookup; pending versions live in CommunicationTemplateVersion.

const PROVIDER_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ACTIVE", "DISABLED"];

export interface TemplateInput {
  name: string;
  channel: NotificationChannel;
  messageType: CommunicationMessageType;
  purpose: CommunicationPurpose;
  language: Locale;
  eventKey?: string | null;
  subject?: string | null;
  body: string;
}

export function validateTemplateContent(input: Pick<TemplateInput, "subject" | "body" | "channel">): string[] {
  const variables = new Set<string>();
  for (const text of [input.subject ?? "", input.body]) {
    const check = validateTemplateText(text, COMMUNICATION_VARIABLES);
    if (!check.ok) throw new HttpError(422, check.message);
    check.variables.forEach((v) => variables.add(v));
    for (const url of findUrls(text)) if (!sanitizeUrl(url)) throw new HttpError(422, "Links in a template must be https URLs on an allow-listed host.");
  }
  if (input.body.trim().length < 3) throw new HttpError(422, "The template body is required.");
  if (input.body.length > (input.channel === "SMS" ? 1000 : 5000)) throw new HttpError(422, "The template body is too long.");
  if (input.channel === "SMS" && input.subject) throw new HttpError(422, "An SMS template has no subject.");
  return [...variables];
}

function validateBinding(input: TemplateInput): void {
  if (!ALLOWED_PURPOSES[input.messageType].includes(input.purpose)) throw new HttpError(422, `Purpose ${input.purpose} is not allowed for ${input.messageType} messages.`);
  if (input.eventKey) {
    if (input.messageType === "MARKETING") throw new HttpError(422, "A marketing template cannot replace a system notification.");
    if (!(input.eventKey in DEFAULT_TEMPLATES)) throw new HttpError(422, "Unknown notification event.");
    const d = describeNotification(input.eventKey as never);
    if (d.messageType !== input.messageType) throw new HttpError(422, `That event is a ${d.messageType} message; the template must use the same message type.`);
  }
}

export async function createTemplate(actor: SessionAdmin, input: TemplateInput): Promise<CommunicationTemplate> {
  if (input.name.trim().length < 3) throw new HttpError(422, "A template name is required.");
  validateBinding(input);
  const variables = validateTemplateContent(input);
  const templateCode = await nextSequenceCode("CTPL");
  const template = await prisma.communicationTemplate.create({
    data: {
      templateCode,
      name: input.name.trim().slice(0, 120),
      channel: input.channel,
      messageType: input.messageType,
      purpose: input.purpose,
      language: input.language,
      eventKey: input.eventKey ?? null,
      subject: input.subject ?? null,
      body: input.body,
      variables: JSON.stringify(variables),
      status: "DRAFT",
      currentVersion: 1,
      createdById: actor.id,
    },
  });
  await prisma.communicationTemplateVersion.create({ data: { templateId: template.id, version: 1, subject: input.subject ?? null, body: input.body, variables: JSON.stringify(variables), status: "DRAFT", changeReason: "Initial version", changedById: actor.id } });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_CREATED", adminId: actor.id, meta: { templateId: template.id, templateCode, channel: input.channel, messageType: input.messageType, purpose: input.purpose } });
  return template;
}

async function latestVersion(templateId: string): Promise<CommunicationTemplateVersion> {
  const v = await prisma.communicationTemplateVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" } });
  if (!v) throw new HttpError(404, "Template version not found.");
  return v;
}

async function loadTemplate(id: string): Promise<CommunicationTemplate> {
  const t = await prisma.communicationTemplate.findUnique({ where: { id } });
  if (!t) throw new HttpError(404, "Template not found.");
  return t;
}

export async function editTemplate(actor: SessionAdmin, id: string, patch: { subject?: string | null; body?: string; changeReason: string }): Promise<CommunicationTemplateVersion> {
  const template = await loadTemplate(id);
  if (["ARCHIVED"].includes(template.status)) throw new HttpError(409, "An archived template cannot be edited.");
  if (patch.changeReason.trim().length < 5) throw new HttpError(422, "A reason for the change is required.");
  const latest = await latestVersion(id);
  const subject = patch.subject === undefined ? latest.subject : patch.subject;
  const body = patch.body ?? latest.body;
  const variables = validateTemplateContent({ subject, body, channel: template.channel });
  const isActive = template.status === "ACTIVE";

  // A DRAFT that was never submitted may be corrected in place; anything else becomes a new version.
  if (latest.status === "DRAFT" && !isActive) {
    const updated = await prisma.communicationTemplateVersion.update({ where: { id: latest.id }, data: { subject, body, variables: JSON.stringify(variables), changeReason: patch.changeReason.trim(), changedById: actor.id } });
    await prisma.communicationTemplate.update({ where: { id }, data: { subject, body, variables: JSON.stringify(variables) } });
    await writeAudit({ action: "COMMUNICATION_TEMPLATE_VERSIONED", adminId: actor.id, meta: { templateId: id, version: updated.version, inPlace: true } });
    return updated;
  }
  const version = template.currentVersion + 1;
  const created = await prisma.communicationTemplateVersion.create({
    data: { templateId: id, version, previousVersion: latest.version, subject, body, variables: JSON.stringify(variables), status: "DRAFT", changeReason: patch.changeReason.trim(), changedById: actor.id },
  });
  // The ACTIVE version keeps serving until this one is approved and activated.
  await prisma.communicationTemplate.update({ where: { id }, data: { currentVersion: version, ...(isActive ? {} : { status: "DRAFT", subject, body, variables: JSON.stringify(variables) }) } });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_VERSIONED", adminId: actor.id, meta: { templateId: id, version, previousVersion: latest.version } });
  return created;
}

async function versionOrLatest(templateId: string, version?: number): Promise<CommunicationTemplateVersion> {
  if (version === undefined) return latestVersion(templateId);
  const v = await prisma.communicationTemplateVersion.findUnique({ where: { templateId_version: { templateId, version } } });
  if (!v) throw new HttpError(404, "Template version not found.");
  return v;
}

export async function submitTemplate(actor: SessionAdmin, id: string, version?: number): Promise<CommunicationTemplateVersion> {
  const template = await loadTemplate(id);
  const v = await versionOrLatest(id, version);
  if (v.status !== "DRAFT") throw new HttpError(409, `A ${v.status.toLowerCase().replace("_", " ")} version cannot be submitted.`);
  validateTemplateContent({ subject: v.subject, body: v.body, channel: template.channel }); // re-validated at the door
  const updated = await prisma.communicationTemplateVersion.update({ where: { id: v.id }, data: { status: "UNDER_REVIEW" } });
  if (template.status !== "ACTIVE") await prisma.communicationTemplate.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_SUBMITTED", adminId: actor.id, meta: { templateId: id, version: v.version } });
  return updated;
}

export async function approveTemplate(actor: SessionAdmin, id: string, version?: number, note?: string): Promise<CommunicationTemplateVersion> {
  const template = await loadTemplate(id);
  const v = await versionOrLatest(id, version);
  if (v.status !== "UNDER_REVIEW") throw new HttpError(409, "Only a version that is under review can be approved.");
  // No self-approval: the person who wrote this version can never approve it, whatever permissions they hold.
  if (v.changedById === actor.id) throw new HttpError(403, "You cannot approve a template version that you wrote.");
  const updated = await prisma.communicationTemplateVersion.update({ where: { id: v.id }, data: { status: "APPROVED" } });
  await prisma.communicationTemplate.update({ where: { id }, data: { approvedById: actor.id, ...(template.status === "ACTIVE" ? {} : { status: "APPROVED" }) } });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_APPROVED", adminId: actor.id, meta: { templateId: id, version: v.version, note: note?.slice(0, 200) } });
  return updated;
}

export type ActivationResult = { approvalRequired: false; template: CommunicationTemplate } | { approvalRequired: true; approvalCode: string; status: string };

const NEEDS_GATE = (t: CommunicationTemplate) => t.channel !== "IN_APP" || t.messageType === "MARKETING";

export async function activateTemplate(actor: SessionAdmin, id: string, version?: number): Promise<ActivationResult> {
  const template = await loadTemplate(id);
  const v = await versionOrLatest(id, version);
  if (v.status !== "APPROVED") throw new HttpError(409, "Only an approved version can be activated.");
  if (template.channel === "WHATSAPP" && !["APPROVED", "ACTIVE"].includes(template.providerStatus ?? "")) {
    throw new HttpError(409, "A WhatsApp template can only be activated after the provider has approved it.");
  }
  let approvalId: string | null = null;
  if (NEEDS_GATE(template)) {
    const gate = await enforceApprovalGate({ actionType: "COMMUNICATION_TEMPLATE_ACTIVATION", sourceType: "CASE", sourceId: template.id, actor, reason: `Activate ${template.templateCode} v${v.version}`, requestedPayload: { templateId: id, version: v.version } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    approvalId = gate.requiresApproval ? gate.approvalRequestId : null;
    if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  }
  const now = new Date();
  // The previously active version is archived (kept for history); the new one goes live.
  if (template.activeVersion && template.activeVersion !== v.version) {
    await prisma.communicationTemplateVersion.updateMany({ where: { templateId: id, version: template.activeVersion }, data: { status: "ARCHIVED" } });
  }
  await prisma.communicationTemplateVersion.update({ where: { id: v.id }, data: { status: "ACTIVE", effectiveAt: now, approvalId } });
  const updated = await prisma.communicationTemplate.update({ where: { id }, data: { status: "ACTIVE", activeVersion: v.version, currentVersion: Math.max(template.currentVersion, v.version), subject: v.subject, body: v.body, variables: v.variables, approvalId } });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_ACTIVATED", adminId: actor.id, meta: { templateId: id, version: v.version, approvalId } });
  return { approvalRequired: false, template: updated };
}

export async function disableTemplate(actor: SessionAdmin, id: string, reason: string): Promise<CommunicationTemplate> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const template = await loadTemplate(id);
  if (template.status === "DISABLED" || template.status === "ARCHIVED") throw new HttpError(409, "This template is already inactive.");
  const updated = await prisma.communicationTemplate.update({ where: { id }, data: { status: "DISABLED" } });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_DISABLED", adminId: actor.id, meta: { templateId: id, reason: reason.trim().slice(0, 200) } });
  return updated;
}

// Provider-side (WhatsApp / SMS) template bookkeeping. This records what the provider reported; it does not call a vendor API.
export async function updateProviderTemplate(actor: SessionAdmin, id: string, data: { providerTemplateName?: string; providerTemplateId?: string; providerCategory?: string; providerStatus?: string }): Promise<CommunicationTemplate> {
  const template = await loadTemplate(id);
  if (data.providerStatus && !PROVIDER_STATUSES.includes(data.providerStatus)) throw new HttpError(422, "Invalid provider status.");
  if (template.channel === "EMAIL" || template.channel === "IN_APP") throw new HttpError(422, "Only SMS and WhatsApp templates have provider-side templates.");
  const updated = await prisma.communicationTemplate.update({
    where: { id },
    data: {
      ...(data.providerTemplateName !== undefined ? { providerTemplateName: data.providerTemplateName.slice(0, 120) } : {}),
      ...(data.providerTemplateId !== undefined ? { providerTemplateId: data.providerTemplateId.slice(0, 120) } : {}),
      ...(data.providerCategory !== undefined ? { providerCategory: data.providerCategory.slice(0, 60) } : {}),
      ...(data.providerStatus !== undefined ? { providerStatus: data.providerStatus } : {}),
      providerSyncedAt: new Date(),
    },
  });
  await writeAudit({ action: "COMMUNICATION_TEMPLATE_VERSIONED", adminId: actor.id, meta: { templateId: id, providerUpdate: true, providerStatus: data.providerStatus } });
  return updated;
}

export async function listTemplates(filter: { channel?: NotificationChannel; status?: string; language?: Locale; take?: number } = {}) {
  return prisma.communicationTemplate.findMany({
    where: { ...(filter.channel ? { channel: filter.channel } : {}), ...(filter.status ? { status: filter.status as never } : {}), ...(filter.language ? { language: filter.language } : {}) },
    orderBy: { updatedAt: "desc" },
    take: Math.min(filter.take ?? 100, 200),
  });
}

export async function getTemplateWithVersions(id: string) {
  const t = await prisma.communicationTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!t) throw new HttpError(404, "Template not found.");
  return t;
}
