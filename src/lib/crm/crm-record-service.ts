import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { HttpError } from "@/lib/http-error";
import type { CommunicationVisibility, LeadSource } from "@prisma/client";

// STEP 28 §2 — the central per-applicant operational record.

export async function createCrmRecord(profileId: string, opts: { leadId?: string; leadSource?: LeadSource | null; referralId?: string | null; couponId?: string | null; promotionId?: string | null; actorId?: string } = {}) {
  const existing = await prisma.crmRecord.findUnique({ where: { profileId } });
  if (existing) return existing;

  const crmCode = await nextSequenceCode("CRM");
  const record = await prisma.crmRecord.create({
    data: {
      crmCode,
      profileId,
      leadId: opts.leadId,
      leadSource: opts.leadSource,
      referralId: opts.referralId,
      couponId: opts.couponId,
      promotionId: opts.promotionId,
      lastActivityAt: new Date(),
    },
  });
  await prisma.crmLifecycleHistory.create({ data: { crmRecordId: record.id, toStage: "REGISTERED", triggeredBy: "AUTOMATION", reason: "CRM record created" } });
  await writeAudit({ action: "CRM_RECORD_CREATED", adminId: opts.actorId, targetProfileId: profileId, meta: { crmRecordId: record.id, crmCode } });
  return record;
}

export async function getCrmRecordByProfileId(profileId: string) {
  return prisma.crmRecord.findUnique({ where: { profileId } });
}

export async function getCrmRecord(id: string) {
  return prisma.crmRecord.findUnique({ where: { id } });
}

export async function touchLastActivity(crmRecordId: string) {
  await prisma.crmRecord.update({ where: { id: crmRecordId }, data: { lastActivityAt: new Date() } }).catch(() => undefined);
}

// ---------- Notes (spec §24/§25) ----------

const DEFAULT_NOTE_VISIBILITY: CommunicationVisibility = "INTERNAL_ONLY";

export async function addCrmNote(crmRecordId: string, authorId: string, body: string, visibility: CommunicationVisibility = DEFAULT_NOTE_VISIBILITY) {
  if (!body.trim()) throw new HttpError(400, "Note text is required.");
  const note = await prisma.crmNote.create({ data: { crmRecordId, authorId, body: body.trim(), visibility } });
  await touchLastActivity(crmRecordId);
  await writeAudit({ action: "CRM_NOTE_ADDED", adminId: authorId, meta: { crmRecordId, noteId: note.id, visibility } });
  return note;
}

export async function editCrmNote(noteId: string, actorId: string, body: string) {
  if (!body.trim()) throw new HttpError(400, "Note text is required.");
  const note = await prisma.crmNote.findUnique({ where: { id: noteId } });
  if (!note || note.deletedAt) throw new HttpError(404, "Note not found.");
  const updated = await prisma.crmNote.update({ where: { id: noteId }, data: { body: body.trim() } });
  await writeAudit({ action: "CRM_NOTE_UPDATED", adminId: actorId, meta: { noteId } });
  return updated;
}

// Soft-delete only, mirrors TaskComment's exact pattern (spec §25).
export async function deleteCrmNote(noteId: string, actorId: string) {
  const note = await prisma.crmNote.findUnique({ where: { id: noteId } });
  if (!note || note.deletedAt) throw new HttpError(404, "Note not found.");
  const updated = await prisma.crmNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  await writeAudit({ action: "CRM_NOTE_DELETED", adminId: actorId, meta: { noteId } });
  return updated;
}

export async function listCrmNotes(crmRecordId: string, visibleTiers: CommunicationVisibility[]) {
  return prisma.crmNote.findMany({ where: { crmRecordId, deletedAt: null, visibility: { in: visibleTiers } }, orderBy: { createdAt: "desc" } });
}

// ---------- Tags (spec §33/§34) ----------

// No stigmatizing/defamatory labels (spec §34) — enforced here, not in the schema.
const DENYLISTED_TAG_WORDS = ["scammer", "fraudster", "fake person", "criminal", "timewaster", "liar", "cheater"];

function assertAllowedTagName(name: string): void {
  const lower = name.trim().toLowerCase();
  if (DENYLISTED_TAG_WORDS.some((w) => lower.includes(w))) {
    throw new HttpError(422, "This tag name is not allowed. Tags must describe operational status, not make accusations about a person.");
  }
}

export async function createCrmTag(actorId: string, input: { name: string; description?: string; category?: string; colorToken?: string; isSystem?: boolean }) {
  assertAllowedTagName(input.name);
  return prisma.crmTag.create({ data: { name: input.name.trim(), description: input.description, category: input.category, colorToken: input.colorToken, isSystem: input.isSystem ?? false, createdById: actorId } });
}

export async function listCrmTags(activeOnly = true) {
  return prisma.crmTag.findMany({ where: activeOnly ? { active: true } : undefined, orderBy: { name: "asc" } });
}

export async function applyTag(crmRecordId: string, tagId: string, actorId: string) {
  const tag = await prisma.crmTag.findUnique({ where: { id: tagId } });
  if (!tag || !tag.active) throw new HttpError(404, "Unknown or inactive tag.");
  const recordTag = await prisma.crmRecordTag.upsert({
    where: { crmRecordId_tagId: { crmRecordId, tagId } },
    update: {},
    create: { crmRecordId, tagId, addedById: actorId },
  });
  await writeAudit({ action: "CRM_TAG_APPLIED", adminId: actorId, meta: { crmRecordId, tagId } });
  return recordTag;
}

export async function removeTag(crmRecordId: string, tagId: string, actorId: string) {
  await prisma.crmRecordTag.delete({ where: { crmRecordId_tagId: { crmRecordId, tagId } } }).catch(() => undefined);
  await writeAudit({ action: "CRM_TAG_REMOVED", adminId: actorId, meta: { crmRecordId, tagId } });
}
