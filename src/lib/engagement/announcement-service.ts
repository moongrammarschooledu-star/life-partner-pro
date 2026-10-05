import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { markApprovalExecuted } from "@/lib/approvals/gate";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { engagementAudit } from "@/lib/engagement/audit";
import { assertApprovedPayloadMatches, gateEngagementAction } from "@/lib/engagement/approval";
import { scanEngagementContent } from "@/lib/engagement/content-scan";
import { ANNOUNCEMENT_AUDIENCES, CONDITION_STAGES, ENGAGEMENT_FLAGS } from "@/lib/engagement/constants";
import type { SessionAdmin } from "@/lib/route-guard";
import type { EngagementAnnouncement } from "@prisma/client";

// STEP 30 — in-app announcements. Targeting is a CLOSED vocabulary: everyone, newly registered, verified, a membership package or a
// CRM lifecycle stage. There is no way to target by religion, caste, sect, health, income, appearance or any profile attribute, and
// nothing about a person's matches or proposals. Lifecycle: DRAFT -> REVIEW -> APPROVED -> SCHEDULED/ACTIVE -> EXPIRED -> ARCHIVED.

export type Audience = (typeof ANNOUNCEMENT_AUDIENCES)[number];
export interface Targeting {
  audience: Audience;
  value?: string;
}

const TAG_LIKE = /<\s*\/?\s*[a-z!][^>]*>/i;
const NEW_USER_DAYS = 30;

export function parseTargeting(raw: unknown): Targeting {
  if (!raw || typeof raw !== "object") throw new HttpError(422, "Targeting is required.");
  const keys = Object.keys(raw as object);
  if (keys.some((k) => k !== "audience" && k !== "value")) throw new HttpError(422, "Only audience and value are allowed in targeting.");
  const { audience, value } = raw as { audience?: unknown; value?: unknown };
  if (typeof audience !== "string" || !(ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(audience)) throw new HttpError(422, "Unknown audience.");
  if (audience === "PACKAGE") {
    if (typeof value !== "string" || !/^[A-Za-z0-9-]{3,40}$/.test(value)) throw new HttpError(422, "A package code is required.");
    return { audience, value };
  }
  if (audience === "LIFECYCLE_STAGE") {
    if (typeof value !== "string" || !(CONDITION_STAGES as readonly string[]).includes(value)) throw new HttpError(422, "Unknown lifecycle stage.");
    return { audience, value };
  }
  if (value !== undefined) throw new HttpError(422, "This audience does not take a value.");
  return { audience: audience as Audience };
}

export interface AnnouncementInput {
  title: string;
  body: string;
  language?: string;
  targeting: unknown;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
}

function clean(input: AnnouncementInput) {
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  const language = (input.language ?? "EN").toUpperCase();
  if (title.length < 3 || title.length > 160) throw new HttpError(422, "A title of 3-160 characters is required.");
  if (body.length < 10 || body.length > 1200) throw new HttpError(422, "The message must be 10-1200 characters.");
  if (language !== "EN" && language !== "UR") throw new HttpError(422, "Language must be EN or UR.");
  if (TAG_LIKE.test(title) || TAG_LIKE.test(body)) throw new HttpError(422, "HTML is not allowed. Use plain text.");
  const targeting = parseTargeting(input.targeting);
  const startAt = input.startAt ? new Date(input.startAt) : null;
  const endAt = input.endAt ? new Date(input.endAt) : null;
  if ((startAt && Number.isNaN(startAt.getTime())) || (endAt && Number.isNaN(endAt.getTime()))) throw new HttpError(422, "Invalid date.");
  if (startAt && endAt && endAt <= startAt) throw new HttpError(422, "The end must be after the start.");
  return { title, body, language, targeting, startAt, endAt };
}

export function announcementHash(a: { title: string; body: string; language: string; targeting: unknown; startAt: Date | null; endAt: Date | null }): string {
  return createHash("sha256").update(JSON.stringify([a.title, a.body, a.language, a.targeting, a.startAt?.toISOString() ?? null, a.endAt?.toISOString() ?? null])).digest("hex");
}

const textsOf = (a: { title: string; body: string }) => [{ field: "title", text: a.title }, { field: "body", text: a.body }];

export async function createAnnouncement(actor: SessionAdmin, input: AnnouncementInput) {
  const c = clean(input);
  const code = await nextSequenceCode("EAN");
  const row = await prisma.engagementAnnouncement.create({ data: { code, ...c, targeting: c.targeting as never, createdById: actor.id } });
  await engagementAudit({ action: "ENGAGEMENT_ANNOUNCEMENT_CHANGED", actorId: actor.id, resource: "engagement_announcement", resourceId: row.id, after: { code, audience: c.targeting.audience } });
  return row;
}

export async function updateAnnouncement(actor: SessionAdmin, id: string, input: AnnouncementInput) {
  const a = await prisma.engagementAnnouncement.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "Announcement not found.");
  if (!["DRAFT", "REVIEW", "APPROVED"].includes(a.status)) throw new HttpError(409, "A live or finished announcement cannot be edited. Archive it and create a new one.");
  const c = clean(input);
  // any change after review sends it back to draft: the approval is for the exact text that was reviewed
  const updated = await prisma.engagementAnnouncement.update({ where: { id }, data: { ...c, targeting: c.targeting as never, status: "DRAFT", contentHash: null, policyScanResult: undefined, reviewerId: null, approvedAt: null, createdById: a.createdById } });
  await engagementAudit({ action: "ENGAGEMENT_ANNOUNCEMENT_CHANGED", actorId: actor.id, resource: "engagement_announcement", resourceId: id, after: { audience: c.targeting.audience } });
  return updated;
}

export async function submitAnnouncement(actor: SessionAdmin, id: string) {
  const a = await prisma.engagementAnnouncement.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "Announcement not found.");
  if (a.status !== "DRAFT") throw new HttpError(409, "Only a draft can be submitted for review.");
  const scan = scanEngagementContent({ texts: textsOf(a) });
  if (!scan.pass) {
    await engagementAudit({ action: "ENGAGEMENT_CONTENT_POLICY_BLOCKED", actorId: actor.id, resource: "engagement_announcement", resourceId: id, extra: { rules: scan.findings.filter((f) => f.severity === "BLOCK").map((f) => f.rule) } });
    throw Object.assign(new HttpError(422, "This announcement conflicts with the engagement content policy."), { findings: scan.findings });
  }
  return prisma.engagementAnnouncement.update({ where: { id }, data: { status: "REVIEW", policyScanResult: scan as never, contentHash: announcementHash(a) } });
}

export async function reviewAnnouncement(actor: SessionAdmin, id: string, decision: "APPROVE" | "REJECT", note?: string) {
  const a = await prisma.engagementAnnouncement.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "Announcement not found.");
  if (a.status !== "REVIEW") throw new HttpError(409, "Only an announcement in review can be decided.");
  if (actor.id === a.createdById) throw new HttpError(403, "You cannot review an announcement you wrote.");
  if (decision === "REJECT" && (note ?? "").trim().length < 5) throw new HttpError(422, "A reason is required to reject.");
  const updated = await prisma.engagementAnnouncement.update({ where: { id }, data: decision === "APPROVE" ? { status: "APPROVED", reviewerId: actor.id, approvedAt: new Date() } : { status: "DRAFT", reviewerId: actor.id } });
  await engagementAudit({ action: "ENGAGEMENT_ANNOUNCEMENT_CHANGED", actorId: actor.id, resource: "engagement_announcement", resourceId: id, after: { decision }, reason: note });
  return updated;
}

export type AnnouncementPublishOutcome = { approvalRequired: false; announcement: EngagementAnnouncement } | { approvalRequired: true; approvalCode: string; status: string };

export async function publishAnnouncement(actor: SessionAdmin, id: string, reason: string, now: Date = new Date()): Promise<AnnouncementPublishOutcome> {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const a = await prisma.engagementAnnouncement.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "Announcement not found.");
  if (a.status !== "APPROVED") throw new HttpError(409, "Only an approved announcement can be published.");
  if (!a.reviewerId || a.reviewerId === a.createdById) throw new HttpError(403, "This announcement has no valid independent review.");
  if (!a.contentHash || announcementHash(a) !== a.contentHash) throw new HttpError(409, "The announcement changed after it was reviewed. Submit it again.");
  parseTargeting(a.targeting);

  const payload = { announcementId: id, contentHash: a.contentHash };
  const gate = await gateEngagementAction({ actionType: "ENGAGEMENT_ANNOUNCEMENT_PUBLISH", sourceId: `announcement:${id}`, actor, reason, requestedPayload: payload });
  if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
  if (gate.requiresApproval) await assertApprovedPayloadMatches(gate.approvalRequestId, payload);

  const status = a.startAt && a.startAt > now ? "SCHEDULED" : "ACTIVE";
  const updated = await prisma.engagementAnnouncement.update({ where: { id }, data: { status } });
  if (gate.requiresApproval) await markApprovalExecuted(gate.approvalRequestId, actor.id);
  await engagementAudit({ action: "ENGAGEMENT_ANNOUNCEMENT_PUBLISHED", actorId: actor.id, resource: "engagement_announcement", resourceId: id, after: { status, contentHash: a.contentHash }, reason, approvalId: gate.requiresApproval ? gate.approvalCode : null });
  return { approvalRequired: false, announcement: updated };
}

export async function archiveAnnouncement(actor: SessionAdmin, id: string, reason: string) {
  if (reason.trim().length < 5) throw new HttpError(422, "A reason is required.");
  const a = await prisma.engagementAnnouncement.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "Announcement not found.");
  const updated = await prisma.engagementAnnouncement.update({ where: { id }, data: { status: "ARCHIVED" } });
  await engagementAudit({ action: "ENGAGEMENT_ANNOUNCEMENT_CHANGED", actorId: actor.id, resource: "engagement_announcement", resourceId: id, after: { status: "ARCHIVED" }, reason });
  return updated;
}

export async function listAnnouncements(filter: { status?: string; take?: number } = {}) {
  return prisma.engagementAnnouncement.findMany({ where: filter.status ? { status: filter.status as never } : {}, orderBy: { createdAt: "desc" }, take: Math.min(filter.take ?? 100, 200), include: { _count: { select: { dismissals: true } } } });
}

// Daily tick: scheduled -> active when their start time arrives; active -> expired when their end time passes.
export async function advanceAnnouncementWindows(now: Date = new Date()): Promise<{ started: number; expired: number }> {
  const started = await prisma.engagementAnnouncement.updateMany({ where: { status: "SCHEDULED", startAt: { lte: now } }, data: { status: "ACTIVE" } });
  const expired = await prisma.engagementAnnouncement.updateMany({ where: { status: { in: ["ACTIVE", "SCHEDULED"] }, endAt: { lte: now } }, data: { status: "EXPIRED" } });
  return { started: started.count, expired: expired.count };
}

// ----- applicant side -----
export async function listActiveAnnouncementsFor(profileId: string, now: Date = new Date()) {
  if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master)) || !(await isFeatureEnabled(ENGAGEMENT_FLAGS.announcements))) return [];
  const [rows, profile, crm, sub, dismissed] = await Promise.all([
    prisma.engagementAnnouncement.findMany({
      where: { status: "ACTIVE", AND: [{ OR: [{ startAt: null }, { startAt: { lte: now } }] }, { OR: [{ endAt: null }, { endAt: { gt: now } }] }] },
      orderBy: { createdAt: "desc" }, take: 20,
    }),
    prisma.profile.findUnique({ where: { id: profileId }, select: { createdAt: true, verified: true, preferredLanguage: true } }),
    prisma.crmRecord.findUnique({ where: { profileId }, select: { lifecycleStage: true } }),
    prisma.subscription.findFirst({ where: { profileId, status: { in: ["ACTIVE", "TRIAL"] } }, select: { package: { select: { packageCode: true } } } }),
    prisma.engagementAnnouncementDismissal.findMany({ where: { profileId }, select: { announcementId: true } }),
  ]);
  if (!profile) return [];
  const gone = new Set(dismissed.map((d) => d.announcementId));
  return rows
    .filter((a) => !gone.has(a.id))
    .filter((a) => {
      let t: Targeting;
      try {
        t = parseTargeting(a.targeting);
      } catch {
        return false; // malformed targeting fails closed
      }
      switch (t.audience) {
        case "ALL": return true;
        case "NEW_USERS": return now.getTime() - profile.createdAt.getTime() <= NEW_USER_DAYS * 86_400_000;
        case "VERIFIED": return profile.verified;
        case "PACKAGE": return sub?.package.packageCode === t.value;
        case "LIFECYCLE_STAGE": return crm?.lifecycleStage === t.value;
      }
    })
    .map((a) => ({ id: a.id, title: a.title, body: a.body, language: a.language }));
}

export async function dismissAnnouncement(profileId: string, announcementId: string): Promise<void> {
  const a = await prisma.engagementAnnouncement.findUnique({ where: { id: announcementId }, select: { id: true, status: true } });
  if (!a || a.status !== "ACTIVE") throw new HttpError(404, "Announcement not found.");
  await prisma.engagementAnnouncementDismissal.upsert({ where: { announcementId_profileId: { announcementId, profileId } }, update: {}, create: { announcementId, profileId } });
}
