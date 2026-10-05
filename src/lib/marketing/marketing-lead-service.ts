import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { updateLeadStatus } from "@/lib/crm/lead-service";
import { marketingAudit } from "@/lib/marketing/audit";
import { gateMarketingAction } from "@/lib/marketing/approval";
import { buildCsvSafe } from "@/lib/marketing/csv";
import { suppressContact } from "@/lib/marketing/suppression";
import type { Permission } from "@/lib/permissions";
import type { SessionAdmin } from "@/lib/route-guard";
import type { Lead, LeadStatus, Prisma } from "@prisma/client";

// STEP 29 §37/§38/§53 — staff-facing marketing lead handling. A marketing lead IS a STEP 28 Lead; this layer adds
// campaign-aware listing, permission-gated contact fields, attribution timeline, status handling and export.
// Contact details (phone, email, free-text inquiry) require sensitive:marketing:lead_contact:view; without it the
// response contains masked values only and the DTO never carries the raw ones.

type Actor = Pick<SessionAdmin, "id" | "permissions" | "role" | "name" | "email" | "sid" | "viewAsBy">;

export function canSeeContact(permissions: Permission[]): boolean {
  return permissions.includes("sensitive:marketing:lead_contact:view");
}

export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? "••••" : `${phone.slice(0, 3)}${"•".repeat(Math.max(phone.length - 7, 3))}${phone.slice(-4)}`;
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}•••@${domain}` : "•••";
}

export interface MarketingLeadDto {
  id: string;
  leadCode: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  inquiry: string | null;
  contactMasked: boolean;
  status: LeadStatus;
  source: string;
  campaignId: string | null;
  campaignCode: string | null;
  platform: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  preferredChannel: string | null;
  marketingOptIn: boolean;
  assignedStaffId: string | null;
  convertedProfileId: string | null;
  dedupeReason: string | null;
  capturedAt: Date | null;
  createdAt: Date;
}

export function toLeadDto(lead: Lead & { marketingCampaign?: { code: string } | null }, permissions: Permission[]): MarketingLeadDto {
  const showContact = canSeeContact(permissions);
  return {
    id: lead.id, leadCode: lead.leadCode, fullName: lead.fullName,
    phone: showContact ? lead.phone : maskPhone(lead.phone),
    email: showContact ? lead.email : maskEmail(lead.email),
    city: lead.city,
    inquiry: showContact ? lead.inquiry : lead.inquiry ? "[hidden — contact permission required]" : null,
    contactMasked: !showContact,
    status: lead.status, source: lead.source, campaignId: lead.campaignId, campaignCode: lead.marketingCampaign?.code ?? lead.campaign ?? null,
    platform: lead.platform, utmSource: lead.utmSource, utmMedium: lead.utmMedium, utmCampaign: lead.utmCampaign,
    preferredChannel: lead.preferredChannel, marketingOptIn: lead.marketingOptIn, assignedStaffId: lead.assignedStaffId,
    convertedProfileId: lead.convertedProfileId, dedupeReason: lead.dedupeReason, capturedAt: lead.capturedAt, createdAt: lead.createdAt,
  };
}

export interface LeadFilter {
  status?: LeadStatus;
  campaignId?: string;
  source?: string;
  from?: Date;
  to?: Date;
  cursor?: string | null;
  take?: number;
}

function whereFor(f: LeadFilter): Prisma.LeadWhereInput {
  return {
    OR: [{ campaignId: { not: null } }, { platform: { not: null } }],
    ...(f.status ? { status: f.status } : {}),
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    ...(f.source ? { source: f.source as never } : {}),
    ...((f.from || f.to) ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

// Cursor pagination (take+1) — never an unbounded read.
export async function listMarketingLeads(actor: Pick<Actor, "permissions">, f: LeadFilter = {}) {
  const take = Math.min(Math.max(f.take ?? 50, 1), 100);
  const rows = await prisma.lead.findMany({
    where: whereFor(f), orderBy: { id: "desc" }, take: take + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { marketingCampaign: { select: { code: true } } },
  });
  const page = rows.slice(0, take);
  return { items: page.map((l) => toLeadDto(l, actor.permissions)), nextCursor: rows.length > take ? page[page.length - 1].id : null };
}

export async function getMarketingLead(actor: Actor, id: string) {
  const lead = await prisma.lead.findUnique({ where: { id }, include: { marketingCampaign: { select: { code: true, name: true } }, attribution: true, marketingConsents: { orderBy: { recordedAt: "desc" } } } });
  if (!lead || (!lead.campaignId && !lead.platform)) throw new HttpError(404, "Marketing lead not found.");
  const showContact = canSeeContact(actor.permissions);
  if (showContact) await marketingAudit({ action: "MARKETING_LEAD_CONTACT_VIEWED", actorId: actor.id, resource: "lead", resourceId: id });

  const [leadEvents, marketingEvents, crmRecord, tasks] = await Promise.all([
    prisma.leadEvent.findMany({ where: { leadId: id }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.marketingEvent.findMany({ where: { leadId: id }, orderBy: { occurredAt: "asc" }, take: 100 }),
    lead.convertedCrmRecordId ? prisma.crmRecord.findUnique({ where: { id: lead.convertedCrmRecordId }, select: { crmCode: true, lifecycleStage: true } }) : null,
    prisma.adminTask.findMany({ where: { resourceType: "LEAD", resourceId: id }, select: { id: true, taskCode: true, taskType: true, status: true, dueAt: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  // The attribution timeline (spec §19): first visit → source/campaign → page → submission → CRM → contact → registration.
  const timeline: Array<{ at: Date; label: string }> = [];
  if (lead.attribution?.touchedAt) timeline.push({ at: lead.attribution.touchedAt, label: `First touch (${lead.attribution.verification.toLowerCase()})${lead.marketingCampaign ? ` — campaign ${lead.marketingCampaign.code}` : ""}` });
  for (const e of marketingEvents) timeline.push({ at: e.occurredAt, label: e.type.replace(/_/g, " ").toLowerCase() });
  for (const e of leadEvents) timeline.push({ at: e.createdAt, label: `Lead status: ${e.fromStatus ?? "—"} → ${e.toStatus}` });
  if (lead.convertedAt) timeline.push({ at: lead.convertedAt, label: `Converted to applicant${crmRecord ? ` (${crmRecord.crmCode}, stage ${crmRecord.lifecycleStage})` : ""}` });
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    lead: toLeadDto(lead, actor.permissions),
    attribution: lead.attribution ? { code: lead.attribution.code, verification: lead.attribution.verification, utm: lead.attribution.utm, referrerHost: lead.attribution.referrerHost, model: lead.attribution.model, touchedAt: lead.attribution.touchedAt } : null,
    consents: lead.marketingConsents.map((c) => ({ purpose: c.purpose, channel: c.channel, granted: c.granted, withdrawnAt: c.withdrawnAt, method: c.method, recordedAt: c.recordedAt, privacyNoticeVersionId: c.privacyNoticeVersionId })),
    crmRecord, tasks, timeline,
  };
}

const MANUAL_STATUSES: LeadStatus[] = ["CONTACTED", "RESPONDED", "QUALIFICATION_PENDING", "QUALIFIED", "REGISTRATION_STARTED", "UNQUALIFIED", "NOT_INTERESTED", "INVALID", "DO_NOT_CONTACT", "ARCHIVED", "DUPLICATE"];

export async function updateMarketingLeadStatus(actor: Actor, id: string, status: LeadStatus, reason: string): Promise<Lead> {
  if (!MANUAL_STATUSES.includes(status)) throw new HttpError(422, "That status cannot be set manually. Conversion happens through CRM lead conversion.");
  if (reason.trim().length < 3) throw new HttpError(422, "A reason is required.");
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead || (!lead.campaignId && !lead.platform)) throw new HttpError(404, "Marketing lead not found.");
  if (lead.status === "CONVERTED") throw new HttpError(409, "A converted lead's status can no longer be changed here.");
  const updated = await updateLeadStatus(id, status, { actorId: actor.id, reason });
  // "Do not contact" must actually stop outreach: suppress across every channel, not just flip a label.
  if (status === "DO_NOT_CONTACT" && (lead.phone || lead.email)) {
    await suppressContact({ phone: lead.phone, email: lead.email, reason: "ADMIN_RESTRICTION", scope: "ALL", note: "Marked do-not-contact", actorId: actor.id }).catch(() => undefined);
    await prisma.lead.update({ where: { id }, data: { marketingOptIn: false } });
  }
  return updated;
}

export const EXPORT_CAP = 5000;

export async function exportMarketingLeads(actor: SessionAdmin, f: LeadFilter, opts: { includeContact: boolean; reason: string }): Promise<{ approvalRequired: true; approvalCode: string; status: string } | { approvalRequired: false; csv: string; count: number; truncated: boolean }> {
  if (opts.reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  if (opts.includeContact && !canSeeContact(actor.permissions)) throw new HttpError(403, "You do not have permission to export contact details.");

  let approvalId: string | null = null;
  let approvalRequestId: string | null = null;
  if (opts.includeContact) {
    const gate = await gateMarketingAction({ actionType: "MARKETING_LEAD_EXPORT", sourceId: `export:${actor.id}:${JSON.stringify({ c: f.campaignId, s: f.status, a: f.from?.toISOString(), b: f.to?.toISOString() })}`, actor, reason: opts.reason, requestedPayload: { includeContact: true, campaignId: f.campaignId ?? null } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    if (gate.requiresApproval) {
      approvalId = gate.approvalCode;
      approvalRequestId = gate.approvalRequestId;
    }
  }

  const rows = await prisma.lead.findMany({ where: whereFor(f), orderBy: { id: "desc" }, take: EXPORT_CAP + 1, include: { marketingCampaign: { select: { code: true } }, attribution: { select: { verification: true } } } });
  const truncated = rows.length > EXPORT_CAP;
  const page = rows.slice(0, EXPORT_CAP);
  const header = ["Lead Code", "Captured", "Status", "Source", "Campaign", "UTM Source", "UTM Medium", "UTM Campaign", "Platform", "Preferred Channel", "Marketing Opt-in", "Attribution", ...(opts.includeContact ? ["Name", "Phone", "Email", "City"] : [])];
  const csv = buildCsvSafe(header, page.map((l) => [
    l.leadCode, l.capturedAt ?? l.createdAt, l.status, l.source, l.marketingCampaign?.code ?? l.campaign ?? "", l.utmSource ?? "", l.utmMedium ?? "", l.utmCampaign ?? "", l.platform ?? "", l.preferredChannel ?? "",
    l.marketingOptIn ? "yes" : "no", l.attribution?.verification ?? "",
    ...(opts.includeContact ? [l.fullName, l.phone ?? "", l.email ?? "", l.city ?? ""] : []),
  ]));
  if (approvalRequestId) await markApprovalExecuted(approvalRequestId, actor.id);
  await marketingAudit({ action: "MARKETING_LEAD_EXPORTED", actorId: actor.id, resource: "lead_export", resourceId: f.campaignId ?? "all", after: { count: page.length, includeContact: opts.includeContact, truncated }, reason: opts.reason, approvalId });
  return { approvalRequired: false, csv, count: page.length, truncated };
}
