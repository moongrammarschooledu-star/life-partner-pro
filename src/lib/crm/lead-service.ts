import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { HttpError } from "@/lib/http-error";
import { createFromEvent } from "@/lib/workflow/engine";
import { notifyLeadAssignedToYou } from "@/lib/notifications/events";
import type { LeadSource, LeadStatus } from "@prisma/client";

// STEP 28 §7-12 — pre-registration lead intake. A Lead predates any
// Profile/CrmRecord; conversion (below) is the only path that creates both.

function normalizePhone(v: string): string {
  return v.replace(/[^0-9]/g, "");
}
function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

export interface CreateLeadInput {
  fullName: string;
  email?: string;
  phone?: string;
  city?: string;
  area?: string;
  inquiry?: string;
  source: LeadSource;
  campaign?: string;
  consentGiven?: boolean;
  referralId?: string;
  couponId?: string;
  promotionId?: string;
  createdById: string;
}

export async function createLead(input: CreateLeadInput) {
  if (!input.fullName.trim()) throw new HttpError(400, "A name is required.");
  const leadCode = await nextSequenceCode("LEAD");
  const lead = await prisma.lead.create({
    data: {
      leadCode,
      fullName: input.fullName.trim(),
      email: input.email,
      phone: input.phone,
      city: input.city,
      area: input.area,
      inquiry: input.inquiry,
      source: input.source,
      campaign: input.campaign,
      consentGiven: input.consentGiven ?? false,
      referralId: input.referralId,
      couponId: input.couponId,
      promotionId: input.promotionId,
      status: "NEW",
      events: { create: { toStatus: "NEW", actorId: input.createdById } },
    },
  });
  await writeAudit({ action: "LEAD_CREATED", adminId: input.createdById, meta: { leadId: lead.id, leadCode } });
  await runDuplicateCheckForLead(lead.id).catch(() => undefined);
  return lead;
}

// STEP 28 §10 — a lightweight, honest phone/email match against existing
// Profile and Lead records. Deliberately NOT the full weighted duplicate-
// confidence engine (src/lib/verification/duplicate-detection.ts) — that
// engine requires a date of birth and verified-provider references neither
// of which exist at lead-intake time (spec §11's minimal-intake-fields
// instruction). A phone/email match at this stage is itself a strong,
// self-explanatory signal that doesn't need a weighted score.
export async function runDuplicateCheckForLead(leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return false;

  const phone = lead.phone ? normalizePhone(lead.phone) : null;
  const email = lead.email ? normalizeEmail(lead.email) : null;
  if (!phone && !email) return false;

  const [matchingProfile, matchingLead] = await Promise.all([
    prisma.profile.findFirst({
      where: { OR: [phone ? { contact: { mobileNumber: { contains: phone } } } : undefined, email ? { contact: { email: { equals: email, mode: "insensitive" } } } : undefined].filter(Boolean) as never[] },
      select: { id: true },
    }),
    prisma.lead.findFirst({
      where: { id: { not: leadId }, OR: [phone ? { phone: { contains: phone } } : undefined, email ? { email: { equals: email, mode: "insensitive" } } : undefined].filter(Boolean) as never[] },
      select: { id: true },
    }),
  ]);

  if (!matchingProfile && !matchingLead) return false;

  await updateLeadStatus(leadId, "DUPLICATE_REVIEW_REQUIRED", { reason: matchingProfile ? "Matches an existing applicant" : "Matches another lead" });
  await createFromEvent({
    eventName: "crm.lead.duplicate_review_required",
    dedupKey: `CRM_DUPLICATE_REVIEW:${leadId}`,
    resourceType: "LEAD",
    resourceId: leadId,
    taskType: "CRM_DUPLICATE_REVIEW",
    title: `Lead ${lead.leadCode} flagged as a potential duplicate`,
  });
  return true;
}

export async function updateLeadStatus(leadId: string, toStatus: LeadStatus, opts: { actorId?: string; reason?: string } = {}) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new HttpError(404, "Lead not found.");

  const [, updated] = await prisma.$transaction([
    prisma.leadEvent.create({ data: { leadId, fromStatus: lead.status, toStatus, reason: opts.reason, actorId: opts.actorId } }),
    prisma.lead.update({ where: { id: leadId }, data: { status: toStatus } }),
  ]);
  await writeAudit({ action: "LEAD_STATUS_CHANGED", adminId: opts.actorId, meta: { leadId, fromStatus: lead.status, toStatus, reason: opts.reason } });
  return updated;
}

export async function assignLead(leadId: string, adminId: string, actorId: string) {
  const updated = await prisma.lead.update({ where: { id: leadId }, data: { assignedStaffId: adminId } });
  await notifyLeadAssignedToYou(adminId, leadId).catch(() => undefined);
  await writeAudit({ action: "CRM_ASSIGNED", adminId: actorId, meta: { leadId, assignedTo: adminId } });
  return updated;
}

// STEP 28 §10 — the only path that creates a real applicant account. Never
// auto-runs for a lead still flagged DUPLICATE_REVIEW_REQUIRED, and never
// proceeds to any outreach step without consentGiven already true (defense
// in depth — the actual send-time consent/preference/suppression checks are
// still STEP 13/23/25's own, never bypassed here).
export async function convertLead(leadId: string, actorId: string, profileId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) throw new HttpError(404, "Lead not found.");
  if (lead.status === "DUPLICATE_REVIEW_REQUIRED") throw new HttpError(409, "This lead is flagged for duplicate review and cannot be converted yet.");
  if (lead.status === "CONVERTED") throw new HttpError(409, "This lead has already been converted.");

  const { createCrmRecord } = await import("@/lib/crm/crm-record-service");
  const crmRecord = await createCrmRecord(profileId, { leadId: lead.id, leadSource: lead.source, referralId: lead.referralId, couponId: lead.couponId, promotionId: lead.promotionId, actorId });

  const [, updatedLead] = await prisma.$transaction([
    prisma.leadEvent.create({ data: { leadId, fromStatus: lead.status, toStatus: "CONVERTED", actorId } }),
    prisma.lead.update({ where: { id: leadId }, data: { status: "CONVERTED", convertedProfileId: profileId, convertedCrmRecordId: crmRecord.id, convertedAt: new Date() } }),
  ]);
  await writeAudit({ action: "LEAD_CONVERTED", adminId: actorId, targetProfileId: profileId, meta: { leadId, crmRecordId: crmRecord.id } });
  return { lead: updatedLead, crmRecord };
}

export async function listLeads(filter: { status?: LeadStatus; assignedStaffId?: string } = {}) {
  return prisma.lead.findMany({ where: filter, orderBy: { createdAt: "desc" }, take: 200 });
}
