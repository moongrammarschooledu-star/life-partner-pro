import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { hasBroadRecordAccess, type AdminRole } from "@/lib/permissions";
import { assertProfileAssignmentAccess } from "@/lib/profile-assignment-access";
import { assertCommunicationAccess } from "@/lib/communication-access";
import { resolveCaseAccessLevel } from "@/lib/case-access";
import { getFamilyMembership } from "@/lib/family/access-control";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CommunicationThread, CommunicationThreadType, CommunicationVisibility } from "@prisma/client";
import { decryptText, encryptText } from "@/lib/communications/crypto";
import { containsProtectedString } from "@/lib/communications/secure-renderer";

// Controlled conversation threads (spec §25-§27, §69). The product rule is enforced structurally:
//   - a thread has AT MOST ONE applicant member: there is no thread type, route or helper through which two applicants can talk;
//   - applicants and family members can only ever read PUBLIC_TO_USER messages, and only in threads they were explicitly added to;
//   - family members must additionally hold a valid family membership for THAT applicant at read/write time;
//   - staff visibility follows the message's visibility level (default INTERNAL_ONLY);
//   - message bodies are encrypted at rest.

export const USER_THREAD_TYPES: CommunicationThreadType[] = ["SUPPORT_THREAD", "PROPOSAL_COORDINATION", "MEETING_COORDINATION", "VERIFICATION_THREAD"];
export const RESOURCE_TYPES = ["PROPOSAL", "CASE", "MEETING", "PROFILE", "VERIFICATION", "RISK_CASE", "TASK", "PAYMENT", "PRIVACY_REQUEST"] as const;
export type ThreadResourceType = (typeof RESOURCE_TYPES)[number];
const MAX_BODY = 2000;

// ---------- pure visibility rules (unit-tested) ----------

export function staffCanSee(visibility: CommunicationVisibility, actor: { id: string; permissions: readonly string[] }, authorId: string | null): boolean {
  if (!actor.permissions.includes("communications:view")) return false;
  switch (visibility) {
    case "PUBLIC_TO_USER":
    case "STAFF_SHARED":
      return true;
    case "INTERNAL_ONLY":
      return authorId === actor.id || actor.permissions.includes("communications:logs:view");
    case "MANAGER_ONLY":
      return actor.permissions.includes("sensitive:communication:view");
  }
}

export function userCanSee(visibility: CommunicationVisibility): boolean {
  return visibility === "PUBLIC_TO_USER";
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_PATTERN = /(?:\+|00)?\d[\d\s().-]{7,}\d/;
// Free text typed by staff that contains an address or number needs the sensitive-send permission (accidental-disclosure guard).
const SEQUENCE_CODE = /\b[A-Z]{2,6}-\d{4}-\d{3,}\b/g; // the platform's own ids (PRP-2026-000123) are long digit runs but are not phone numbers
export function containsContactPattern(text: string): boolean {
  const scrubbed = text.replace(SEQUENCE_CODE, " ");
  return EMAIL_PATTERN.test(scrubbed) || PHONE_PATTERN.test(scrubbed);
}

// ---------- access to the underlying record ----------

async function assertResourceAccess(admin: SessionAdmin, resourceType: string | null | undefined, resourceId: string | null | undefined, profileId: string | null | undefined): Promise<{ profileId: string | null; protectedStrings: string[] }> {
  let profile = profileId ?? null;
  const protectedStrings: string[] = [];
  if (resourceType === "PROPOSAL" && resourceId) {
    const proposal = await prisma.proposal.findUnique({ where: { id: resourceId }, select: { assignedToId: true, profileAId: true, profileBId: true } });
    if (!proposal) throw new HttpError(404, "Proposal not found.");
    assertCommunicationAccess({ id: admin.id, role: admin.role }, proposal);
    if (profile && profile !== proposal.profileAId && profile !== proposal.profileBId) throw new HttpError(422, "That profile is not a party to the proposal.");
    // The OTHER party's contact details must never appear in a message to this party.
    const otherId = profile ? (profile === proposal.profileAId ? proposal.profileBId : proposal.profileAId) : null;
    if (otherId) {
      const c = await prisma.contactInfo.findUnique({ where: { profileId: otherId }, select: { mobileNumber: true, whatsappNumber: true, email: true } });
      if (c) protectedStrings.push(c.mobileNumber, c.whatsappNumber ?? "", c.email);
    }
  } else if (resourceType === "CASE" && resourceId) {
    const c = await prisma.case.findUnique({ where: { id: resourceId }, select: { id: true, reportedAdminId: true, reporterProfileId: true } });
    if (!c) throw new HttpError(404, "Case not found.");
    if ((await resolveCaseAccessLevel({ id: admin.id, role: admin.role as AdminRole, permissions: admin.permissions } as never, c)) === "NONE") throw new HttpError(403, "You do not have access to this case.");
    profile = profile ?? c.reporterProfileId;
  } else if (resourceType && ["PROFILE", "VERIFICATION", "MEETING"].includes(resourceType) && profile) {
    await assertProfileAssignmentAccess({ id: admin.id, role: admin.role }, profile);
  } else if (resourceType) {
    // Other record types have no row-scoping helper of their own: only broad-access roles may attach a thread to them.
    if (!hasBroadRecordAccess(admin.role)) throw new HttpError(403, "You do not have access to attach a conversation to this record.");
  } else if (profile) {
    await assertProfileAssignmentAccess({ id: admin.id, role: admin.role }, profile);
  }
  return { profileId: profile, protectedStrings };
}

// ---------- create ----------

export interface CreateThreadInput {
  type: CommunicationThreadType;
  subject: string;
  resourceType?: ThreadResourceType | null;
  resourceId?: string | null;
  profileId?: string | null; // the ONE applicant this conversation concerns
  familyMemberIds?: string[]; // only members of THAT applicant's family account
}

export async function createThread(actor: SessionAdmin, input: CreateThreadInput): Promise<CommunicationThread> {
  if (input.subject.trim().length < 3) throw new HttpError(422, "A subject is required.");
  if (input.resourceType && !RESOURCE_TYPES.includes(input.resourceType)) throw new HttpError(422, "Unknown record type.");
  const { profileId } = await assertResourceAccess(actor, input.resourceType, input.resourceId, input.profileId);

  if (input.type === "INTERNAL_ADMIN_THREAD" && (profileId && input.familyMemberIds?.length)) throw new HttpError(422, "An internal thread cannot include family members.");
  if (USER_THREAD_TYPES.includes(input.type) && !profileId) throw new HttpError(422, "This kind of thread needs the applicant it concerns.");
  if (input.type === "FAMILY_COORDINATION" && (!profileId || !input.familyMemberIds?.length)) throw new HttpError(422, "A family thread needs the applicant and at least one family member.");

  for (const fmId of input.familyMemberIds ?? []) {
    const membership = await getFamilyMembership(fmId);
    if (!membership || membership.applicantId !== profileId) throw new HttpError(422, "A family member can only join a thread about their own applicant.");
  }

  const thread = await prisma.communicationThread.create({
    data: {
      threadCode: await nextSequenceCode("THR"),
      type: input.type,
      subject: input.subject.trim().slice(0, 160),
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      profileId: input.type === "INTERNAL_ADMIN_THREAD" ? (profileId ?? null) : profileId,
      createdById: actor.id,
    },
  });
  const members: Array<{ threadId: string; memberType: string; profileId?: string; familyMemberId?: string; adminId?: string; addedById: string }> = [{ threadId: thread.id, memberType: "ADMIN", adminId: actor.id, addedById: actor.id }];
  if (input.type !== "INTERNAL_ADMIN_THREAD" && input.type !== "FAMILY_COORDINATION" && profileId) members.push({ threadId: thread.id, memberType: "PROFILE", profileId, addedById: actor.id });
  for (const fmId of input.familyMemberIds ?? []) members.push({ threadId: thread.id, memberType: "FAMILY_MEMBER", familyMemberId: fmId, addedById: actor.id });
  await prisma.communicationThreadMember.createMany({ data: members });
  await writeAudit({ action: "COMMUNICATION_THREAD_CREATED", adminId: actor.id, targetProfileId: profileId, meta: { threadId: thread.id, type: input.type, resourceType: input.resourceType ?? null } });
  return thread;
}

// ---------- staff messages ----------

async function loadThread(id: string) {
  const t = await prisma.communicationThread.findUnique({ where: { id }, include: { members: true } });
  if (!t) throw new HttpError(404, "Conversation not found.");
  return t;
}

export async function postStaffMessage(actor: SessionAdmin, threadId: string, params: { body: string; visibility?: CommunicationVisibility }) {
  const thread = await loadThread(threadId);
  if (thread.status !== "OPEN") throw new HttpError(409, "This conversation is closed.");
  await assertResourceAccess(actor, thread.resourceType, thread.resourceId, thread.profileId);
  const body = params.body.trim();
  if (body.length < 1 || body.length > MAX_BODY) throw new HttpError(422, `A message must be 1 to ${MAX_BODY} characters.`);
  const visibility: CommunicationVisibility = params.visibility ?? "INTERNAL_ONLY"; // the safe default
  if (thread.type === "INTERNAL_ADMIN_THREAD" && visibility === "PUBLIC_TO_USER") throw new HttpError(422, "An internal thread has no user-visible messages.");
  if (visibility === "PUBLIC_TO_USER") {
    if (!actor.permissions.includes("communications:send")) throw new HttpError(403, "Forbidden: insufficient permissions");
    if (containsContactPattern(body) && !actor.permissions.includes("communications:send_sensitive") && !actor.permissions.includes("sensitive:communication:send")) {
      throw new HttpError(403, "A message the applicant will see cannot contain an e-mail address or phone number without the sensitive-communication permission.");
    }
    // Never disclose the other party of a proposal.
    const { protectedStrings } = await assertResourceAccess(actor, thread.resourceType, thread.resourceId, thread.profileId);
    if (containsProtectedString(body, protectedStrings)) throw new HttpError(422, "This message would disclose another person's contact details.");
  }
  if (visibility === "MANAGER_ONLY" && !actor.permissions.includes("sensitive:communication:view")) throw new HttpError(403, "Forbidden: insufficient permissions");

  const message = await prisma.communicationThreadMessage.create({ data: { threadId, authorType: "ADMIN", authorId: actor.id, visibility, body: encryptText(body), bodyEncrypted: true } });
  await prisma.communicationThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
  await writeAudit({ action: "COMMUNICATION_THREAD_MESSAGE", adminId: actor.id, targetProfileId: thread.profileId, meta: { threadId, messageId: message.id, visibility } });

  if (visibility === "PUBLIC_TO_USER") {
    // A neutral in-app pointer only - the words themselves stay in the thread, behind the recipient's own login.
    const { sendNotification } = await import("@/lib/notifications/notification-service");
    for (const m of thread.members) {
      if (m.memberType === "PROFILE" && m.profileId) await sendNotification({ profileId: m.profileId, type: "ADMIN_DIRECT_MESSAGE", data: {} });
      if (m.memberType === "FAMILY_MEMBER" && m.familyMemberId) await sendNotification({ familyMemberId: m.familyMemberId, type: "ADMIN_DIRECT_MESSAGE", data: {} });
    }
  }
  return message;
}

// Internal comment on a record: an INTERNAL_ADMIN_THREAD per record (created on demand). Never visible to an applicant.
export async function addInternalComment(actor: SessionAdmin, params: { resourceType: ThreadResourceType; resourceId: string; profileId?: string | null; body: string; visibility?: CommunicationVisibility }) {
  const existing = await prisma.communicationThread.findFirst({ where: { type: "INTERNAL_ADMIN_THREAD", resourceType: params.resourceType, resourceId: params.resourceId, status: "OPEN" } });
  const thread = existing ?? (await createThread(actor, { type: "INTERNAL_ADMIN_THREAD", subject: `Internal notes - ${params.resourceType.toLowerCase().replace("_", " ")}`, resourceType: params.resourceType, resourceId: params.resourceId, profileId: params.profileId ?? null }));
  const visibility = params.visibility === "PUBLIC_TO_USER" ? "INTERNAL_ONLY" : (params.visibility ?? "INTERNAL_ONLY");
  return postStaffMessage(actor, thread.id, { body: params.body, visibility });
}

export async function listStaffThreadMessages(actor: SessionAdmin, threadId: string) {
  const thread = await loadThread(threadId);
  await assertResourceAccess(actor, thread.resourceType, thread.resourceId, thread.profileId);
  const messages = await prisma.communicationThreadMessage.findMany({ where: { threadId }, orderBy: { createdAt: "asc" }, take: 500 });
  return {
    thread: { id: thread.id, threadCode: thread.threadCode, type: thread.type, subject: thread.subject, status: thread.status, resourceType: thread.resourceType, resourceId: thread.resourceId },
    messages: messages.filter((m) => staffCanSee(m.visibility, actor, m.authorId)).map((m) => ({ id: m.id, authorType: m.authorType, authorId: m.authorId, visibility: m.visibility, createdAt: m.createdAt, body: safeDecrypt(m.body, m.bodyEncrypted) })),
  };
}

export async function listStaffThreads(actor: SessionAdmin, filter: { type?: CommunicationThreadType; profileId?: string; status?: "OPEN" | "CLOSED" | "ARCHIVED"; take?: number } = {}) {
  const threads = await prisma.communicationThread.findMany({
    where: { ...(filter.type ? { type: filter.type } : {}), ...(filter.profileId ? { profileId: filter.profileId } : {}), ...(filter.status ? { status: filter.status } : {}) },
    orderBy: { updatedAt: "desc" },
    take: Math.min(filter.take ?? 50, 100),
    select: { id: true, threadCode: true, type: true, subject: true, status: true, resourceType: true, resourceId: true, profileId: true, updatedAt: true },
  });
  // Broad roles see every thread; assignment-scoped staff only threads on records they can access.
  if (hasBroadRecordAccess(actor.role)) return threads;
  const allowed = [];
  for (const t of threads) {
    try {
      await assertResourceAccess(actor, t.resourceType, t.resourceId, t.profileId);
      allowed.push(t);
    } catch {
      // not visible to this reviewer
    }
  }
  return allowed;
}

export async function closeThread(actor: SessionAdmin, threadId: string): Promise<CommunicationThread> {
  const thread = await loadThread(threadId);
  await assertResourceAccess(actor, thread.resourceType, thread.resourceId, thread.profileId);
  if (thread.status !== "OPEN") throw new HttpError(409, "This conversation is already closed.");
  return prisma.communicationThread.update({ where: { id: threadId }, data: { status: "CLOSED", closedAt: new Date() } });
}

function safeDecrypt(body: string, encrypted: boolean): string | null {
  if (!encrypted) return body;
  try {
    return decryptText(body);
  } catch {
    return null;
  }
}

// ---------- applicant / family side ----------

export async function listThreadsForProfile(profileId: string) {
  const memberships = await prisma.communicationThreadMember.findMany({ where: { profileId, memberType: "PROFILE" }, select: { threadId: true } });
  if (memberships.length === 0) return [];
  const threads = await prisma.communicationThread.findMany({ where: { id: { in: memberships.map((m) => m.threadId) }, type: { in: USER_THREAD_TYPES } }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, threadCode: true, type: true, subject: true, status: true, updatedAt: true } });
  return threads;
}

export async function getThreadForProfile(profileId: string, threadId: string) {
  const member = await prisma.communicationThreadMember.findFirst({ where: { threadId, profileId, memberType: "PROFILE" } });
  const thread = member ? await prisma.communicationThread.findUnique({ where: { id: threadId } }) : null;
  if (!member || !thread || !USER_THREAD_TYPES.includes(thread.type)) throw new HttpError(404, "Conversation not found."); // same 404 whether it exists or is someone else's
  const messages = await prisma.communicationThreadMessage.findMany({ where: { threadId, visibility: "PUBLIC_TO_USER" }, orderBy: { createdAt: "asc" }, take: 300 });
  return {
    thread: { id: thread.id, threadCode: thread.threadCode, type: thread.type, subject: thread.subject, status: thread.status, canReply: member.canReply && thread.status === "OPEN" },
    messages: messages.map((m) => ({ id: m.id, from: m.authorType === "PROFILE" ? "you" : "team", createdAt: m.createdAt, body: safeDecrypt(m.body, m.bodyEncrypted) })),
  };
}

export async function postProfileMessage(profileId: string, threadId: string, bodyRaw: string) {
  const body = bodyRaw.trim();
  if (body.length < 1 || body.length > MAX_BODY) throw new HttpError(422, `A message must be 1 to ${MAX_BODY} characters.`);
  const member = await prisma.communicationThreadMember.findFirst({ where: { threadId, profileId, memberType: "PROFILE" } });
  const thread = member ? await prisma.communicationThread.findUnique({ where: { id: threadId } }) : null;
  if (!member || !thread || !USER_THREAD_TYPES.includes(thread.type)) throw new HttpError(404, "Conversation not found.");
  if (!member.canReply || thread.status !== "OPEN") throw new HttpError(409, "You cannot reply to this conversation.");
  const message = await prisma.communicationThreadMessage.create({ data: { threadId, authorType: "PROFILE", authorId: profileId, visibility: "PUBLIC_TO_USER", body: encryptText(body), bodyEncrypted: true } });
  await prisma.communicationThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
  await writeAudit({ action: "COMMUNICATION_THREAD_MESSAGE", targetProfileId: profileId, meta: { threadId, messageId: message.id, by: "applicant" } });
  const { notifyAdmins } = await import("@/lib/notifications/notification-service");
  await notifyAdmins({ type: "USER_RESPONDED", data: { relatedProfileId: profileId }, roles: ["SUPPORT_MANAGER", "COMMUNICATION_MANAGER"] });
  return { id: message.id };
}

export async function listThreadsForFamilyMember(familyMemberId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  if (!membership) return [];
  const members = await prisma.communicationThreadMember.findMany({ where: { familyMemberId, memberType: "FAMILY_MEMBER" }, select: { threadId: true } });
  if (members.length === 0) return [];
  // Only threads about THIS family's applicant (defence in depth against a mis-added member).
  return prisma.communicationThread.findMany({ where: { id: { in: members.map((m) => m.threadId) }, profileId: membership.applicantId }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, threadCode: true, type: true, subject: true, status: true, updatedAt: true } });
}

export async function getThreadForFamilyMember(familyMemberId: string, threadId: string) {
  const membership = await getFamilyMembership(familyMemberId);
  const member = membership ? await prisma.communicationThreadMember.findFirst({ where: { threadId, familyMemberId, memberType: "FAMILY_MEMBER" } }) : null;
  const thread = member ? await prisma.communicationThread.findUnique({ where: { id: threadId } }) : null;
  if (!membership || !member || !thread || thread.profileId !== membership.applicantId) throw new HttpError(404, "Conversation not found.");
  const messages = await prisma.communicationThreadMessage.findMany({ where: { threadId, visibility: "PUBLIC_TO_USER" }, orderBy: { createdAt: "asc" }, take: 300 });
  return {
    thread: { id: thread.id, threadCode: thread.threadCode, type: thread.type, subject: thread.subject, status: thread.status },
    messages: messages.map((m) => ({ id: m.id, from: m.authorType === "FAMILY_MEMBER" && m.authorId === familyMemberId ? "you" : m.authorType === "ADMIN" ? "team" : "family", createdAt: m.createdAt, body: safeDecrypt(m.body, m.bodyEncrypted) })),
  };
}
