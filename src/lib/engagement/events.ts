import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { ENGAGEMENT_FLAGS, KIND_SATISFIED_BY, ONCE_PER_PROFILE_EVENTS, REMINDER_KINDS, USER_ACTIVITY_EVENTS } from "@/lib/engagement/constants";
import type { EngagementEventType } from "@prisma/client";

// STEP 30 — EngagementEventService. Records ONE standardised event per real business event, idempotently, and keeps the
// per-applicant activity state current. Properties that matter:
//  - never throws: a failure here must not break registration, a proposal response or a login;
//  - idempotent: `eventKey` is unique, so a replayed event (webhook retry, double click, duplicate tap) is stored once and
//    does not start a second workflow, task, reminder or reward;
//  - data minimisation: the payload keeps only ids / counts / short enum-like values; anything that looks like contact data,
//    a name, a score or a free-text note is dropped before it reaches the database.

const SENSITIVE_KEY = /(email|phone|mobile|whatsapp|name|address|city|religion|sect|caste|income|salary|health|disab|dob|birth|cnic|passport|photo|score|risk|note|message|comment|password|token|secret|ipaddress|clientip|userip|useragent)/i;

export function sanitizePayload(payload: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!payload) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/.test(k) || SENSITIVE_KEY.test(k)) continue;
    if (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    else if (typeof v === "string" && v.length <= 60 && /^[A-Za-z0-9_.:\- ]*$/.test(v)) out[k] = v;
    if (Object.keys(out).length >= 12) break;
  }
  return Object.keys(out).length ? out : undefined;
}

export function buildEventKey(type: EngagementEventType, profileId: string, sourceKey?: string, at: Date = new Date()): string {
  if (ONCE_PER_PROFILE_EVENTS.includes(type)) return `${type}:${profileId}:once`;
  if (type === "LOGIN") return `LOGIN:${profileId}:${at.toISOString().slice(0, 10)}`; // at most one login event per day
  return `${type}:${profileId}:${sourceKey ?? at.toISOString()}`;
}

export interface RecordEventInput {
  profileId: string;
  type: EngagementEventType;
  // the business object that caused it (proposal id, meeting id, case id ...): makes the event key unique per object
  sourceKey?: string;
  refType?: string;
  refId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface RecordEventResult {
  recorded: boolean;
  duplicate?: boolean;
  eventId?: string;
  eventKey?: string;
}

export async function recordEngagementEvent(input: RecordEventInput): Promise<RecordEventResult> {
  try {
    if (!(await isFeatureEnabled(ENGAGEMENT_FLAGS.master)) || !(await isFeatureEnabled(ENGAGEMENT_FLAGS.events))) return { recorded: false };
    const occurredAt = input.occurredAt ?? new Date();
    const eventKey = buildEventKey(input.type, input.profileId, input.sourceKey ?? input.refId, occurredAt);

    let eventId: string;
    try {
      const row = await prisma.engagementEvent.create({
        data: { eventKey, profileId: input.profileId, type: input.type, refType: input.refType?.slice(0, 40), refId: input.refId?.slice(0, 60), payload: sanitizePayload(input.payload) as never, occurredAt },
        select: { id: true },
      });
      eventId = row.id;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return { recorded: false, duplicate: true, eventKey };
      throw error;
    }

    if (USER_ACTIVITY_EVENTS.includes(input.type)) await markActive(input.profileId, occurredAt, input.type);
    await settleSatisfiedReminders(input.profileId, input.type, input.refId);
    // Workflows react after the event is safely stored; they are isolated so a workflow bug can never undo the event.
    if (await isFeatureEnabled(ENGAGEMENT_FLAGS.workflows)) {
      try {
        const { onEngagementEvent } = await import("@/lib/engagement/workflow-runner");
        await onEngagementEvent({ id: eventId, eventKey, profileId: input.profileId, type: input.type, refType: input.refType ?? null, refId: input.refId ?? null, occurredAt });
      } catch (error) {
        console.error("[engagement] workflow dispatch failed", error instanceof Error ? error.message : "error");
      }
    }
    return { recorded: true, eventId, eventKey };
  } catch (error) {
    console.error("[engagement] event record failed", error instanceof Error ? error.message : "error");
    return { recorded: false };
  }
}

async function markActive(profileId: string, at: Date, type: EngagementEventType): Promise<void> {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  await prisma.engagementProfileState.upsert({
    where: { profileId },
    update: { lastActivityAt: at, activityState: "ACTIVE", ...(type === "LOGIN" ? { lastLoginDay: day } : {}) },
    create: { profileId, lastActivityAt: at, activityState: "ACTIVE", ...(type === "LOGIN" ? { lastLoginDay: day } : {}) },
  });
}

// The applicant did the thing a reminder was asking for -> it stops now. Reminders already sent are marked RESPONDED so the
// re-engagement response rate is real, never inferred.
export async function settleSatisfiedReminders(profileId: string, type: EngagementEventType, refId?: string): Promise<number> {
  const kinds = REMINDER_KINDS.filter((k) => KIND_SATISFIED_BY[k].includes(type));
  if (kinds.length === 0) return 0;
  const now = new Date();
  const ref = refId ? { OR: [{ refId: null }, { refId }] } : {};
  const cancelled = await prisma.engagementReminder.updateMany({
    where: { profileId, kind: { in: [...kinds] }, state: { in: ["SCHEDULED", "ELIGIBLE"] }, ...ref },
    data: { state: "CANCELLED", cancelledAt: now, cancelReason: "APPLICANT_ACTED" },
  });
  const responded = await prisma.engagementReminder.updateMany({
    where: { profileId, kind: { in: [...kinds] }, state: "SENT", sentAt: { gte: new Date(now.getTime() - 14 * 86_400_000) }, ...ref },
    data: { state: "RESPONDED", respondedAt: now },
  });
  return cancelled.count + responded.count;
}
