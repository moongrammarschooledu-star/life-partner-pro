import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { validateValue } from "@/lib/platform/config-values";
import { ANNOUNCEMENT_KINDS, audienceMatches, isAnnouncementLive, isPublicFacing, publicSafetyProblems, validateAudience } from "@/lib/platform/announcement-rules";
import { recordConfigChange } from "@/lib/platform/config-change";
import { currentEnvironment } from "@/lib/platform/environment-core";

// Platform announcements (STEP 36 §58). Deliberately NOT blocked by a change freeze: telling people about an incident is exactly what is needed during one.
// Text is plain text, rendered as text only, and checked before it can reach an audience outside the administrator team: no internal detail may be published.

export interface AnnouncementInput {
  kind: unknown;
  title: unknown;
  body: unknown;
  audience: unknown;
  showOnStatusPage?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
}

function parseInput(input: AnnouncementInput) {
  const kind = input.kind as (typeof ANNOUNCEMENT_KINDS)[number];
  if (!(ANNOUNCEMENT_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, "Unknown kind of announcement.");
  const title = validateValue({ type: "STRING", maxLength: 160 }, input.title);
  if (!title.ok) throw new ApiError(400, `Title: ${title.error}`);
  const body = validateValue({ type: "STRING", maxLength: 1200 }, input.body);
  if (!body.ok) throw new ApiError(400, `Message: ${body.error}`);
  const aud = validateAudience(input.audience);
  if (!aud.ok) throw new ApiError(400, aud.error);
  const showOnStatusPage = input.showOnStatusPage === true;
  const startsAt = input.startsAt ? new Date(String(input.startsAt)) : null;
  const endsAt = input.endsAt ? new Date(String(input.endsAt)) : null;
  if ((startsAt && Number.isNaN(startsAt.getTime())) || (endsAt && Number.isNaN(endsAt.getTime()))) throw new ApiError(400, "Invalid date.");
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) throw new ApiError(400, "The end must be after the start.");
  if (isPublicFacing(aud.audience, showOnStatusPage)) {
    const problems = publicSafetyProblems(`${title.value as string}\n${body.value as string}`);
    if (problems.length > 0) throw new ApiError(422, `This text is going to people outside the administrator team, so it must not contain ${problems.join(", ")}. Describe what is affected and when, nothing internal.`);
  }
  return { kind, title: title.value as string, body: body.value as string, audience: aud.audience, showOnStatusPage, startsAt, endsAt };
}

function need(admin: SessionAdmin, permission: "platform:announcements:manage" | "platform:announcements:view") {
  if (!admin.permissions.includes(permission)) throw new ApiError(403, "Forbidden: insufficient permissions");
}

export async function listAnnouncements(limit = 50) {
  return prisma.platformAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(100, limit) });
}

export async function createAnnouncement(admin: SessionAdmin, input: AnnouncementInput) {
  need(admin, "platform:announcements:manage");
  const data = parseInput(input);
  const row = await prisma.platformAnnouncement.create({ data: { ...data, createdById: admin.id } });
  await recordConfigChange({ kind: "ANNOUNCEMENT", key: row.id, before: null, after: { status: "DRAFT", kind: data.kind, audience: data.audience }, actor: admin, environment: currentEnvironment() });
  await writeAudit({ action: "PLATFORM_ANNOUNCEMENT_CHANGED", adminId: admin.id, meta: { id: row.id, change: "CREATED", kind: data.kind, audience: data.audience } });
  return row;
}

export type AnnouncementAction = "UPDATE" | "PUBLISH" | "RESOLVE" | "END";

export async function changeAnnouncement(admin: SessionAdmin, id: string, action: AnnouncementAction, input?: AnnouncementInput) {
  need(admin, "platform:announcements:manage");
  const existing = await prisma.platformAnnouncement.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Not found.");

  if (action === "UPDATE") {
    if (existing.status !== "DRAFT") throw new ApiError(409, "Only a draft can be edited. End it and write a new one.");
    if (!input) throw new ApiError(400, "Nothing to update.");
    const data = parseInput(input);
    const row = await prisma.platformAnnouncement.update({ where: { id }, data: { ...data, updatedById: admin.id } });
    await writeAudit({ action: "PLATFORM_ANNOUNCEMENT_CHANGED", adminId: admin.id, meta: { id, change: "UPDATED" } });
    return row;
  }

  const next = action === "PUBLISH" ? "PUBLISHED" : action === "RESOLVE" ? "RESOLVED" : "ENDED";
  const allowedFrom: Record<string, string[]> = { PUBLISHED: ["DRAFT"], RESOLVED: ["PUBLISHED"], ENDED: ["DRAFT", "PUBLISHED", "RESOLVED"] };
  if (!allowedFrom[next].includes(existing.status)) throw new ApiError(409, `A ${existing.status.toLowerCase()} announcement cannot do that.`);
  if (next === "PUBLISHED") {
    // Re-check at publish time: the text may have been written when it was a private draft.
    parseInput({ kind: existing.kind, title: existing.title, body: existing.body, audience: existing.audience, showOnStatusPage: existing.showOnStatusPage, startsAt: existing.startsAt, endsAt: existing.endsAt });
  }
  const claimed = await prisma.platformAnnouncement.updateMany({ where: { id, status: existing.status }, data: { status: next, updatedById: admin.id, ...(next === "RESOLVED" ? { resolvedAt: new Date() } : {}) } });
  if (claimed.count !== 1) throw new ApiError(409, "Someone else changed this announcement. Reload and try again.");
  await recordConfigChange({ kind: "ANNOUNCEMENT", key: id, before: { status: existing.status }, after: { status: next }, actor: admin, environment: currentEnvironment() });
  await writeAudit({ action: "PLATFORM_ANNOUNCEMENT_CHANGED", adminId: admin.id, meta: { id, change: next } });
  return prisma.platformAnnouncement.findUnique({ where: { id } });
}

/** What a given audience should see right now: published, inside its window, matching the audience. Only title, kind and message leave this function. */
export async function activeAnnouncementsFor(who: { scope: "public" | "applicant" | "family" | "admin"; role?: string }, now: Date = new Date()) {
  const rows = await prisma.platformAnnouncement.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.filter((r) => isAnnouncementLive(r, now) && audienceMatches(r.audience, who)).map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body }));
}
