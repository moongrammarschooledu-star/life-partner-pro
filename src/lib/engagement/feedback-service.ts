import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { createFromEvent } from "@/lib/workflow/engine";
import { nextSequenceCode } from "@/lib/privacy/codes";
import { engagementAudit } from "@/lib/engagement/audit";
import { scanEngagementContent } from "@/lib/engagement/content-scan";
import { ENGAGEMENT_FLAGS, MEETING_FOLLOWUP_CHOICES, SURVEY_KINDS, type MeetingFollowupChoice } from "@/lib/engagement/constants";
import type { SessionAdmin } from "@/lib/route-guard";
import type { EngagementFeedbackStatus, EngagementFeedbackType } from "@prisma/client";

// STEP 30 — feedback, surveys and meeting follow-up choices.
//  - Feedback is about the PLATFORM and SUPPORT (never about a person or a match outcome); ratings are 1-5 satisfaction only.
//  - A meeting follow-up choice is the applicant's own answer to "what would you like next?". It creates a staff TASK and an
//    engagement event. It NEVER changes the proposal, the profile, the CRM stage or any status, and nothing is decided for them.
//  - Applicant text is stored as plain text (angle brackets rejected) and is returned only to staff with feedback permission; the
//    internal note is never returned to the applicant.

const TAG_LIKE = /<\s*\/?\s*[a-z!][^>]*>/i;
const APPLICANT_TYPES: EngagementFeedbackType[] = ["PLATFORM", "FEATURE_REQUEST", "SUPPORT", "EXPERIENCE", "BUG_REPORT"];

export const FEEDBACK_CHOICE_LABELS: Record<MeetingFollowupChoice, { EN: string; UR: string }> = {
  FURTHER_DISCUSSION: { EN: "I would like to continue talking", UR: "میں بات چیت جاری رکھنا چاہتا/چاہتی ہوں" },
  NEED_MORE_INFORMATION: { EN: "I need more information", UR: "مجھے مزید معلومات درکار ہیں" },
  NOT_INTERESTED: { EN: "I would like to step back from this proposal", UR: "میں اس تجویز سے پیچھے ہٹنا چاہتا/چاہتی ہوں" },
  CONTACT_ADMIN: { EN: "I would like the team to contact me", UR: "میں چاہتا/چاہتی ہوں کہ ٹیم مجھ سے رابطہ کرے" },
  NO_DECISION_YET: { EN: "I have not decided yet", UR: "میں نے ابھی فیصلہ نہیں کیا" },
};

export async function feedbackEnabled(): Promise<boolean> {
  return (await isFeatureEnabled(ENGAGEMENT_FLAGS.master)) && (await isFeatureEnabled(ENGAGEMENT_FLAGS.feedback));
}

function plain(value: unknown, min: number, max: number, name: string): string {
  const v = typeof value === "string" ? value.trim() : "";
  if (v.length < min || v.length > max) throw new HttpError(422, `${name} must be ${min}-${max} characters.`);
  if (TAG_LIKE.test(v)) throw new HttpError(422, `${name} cannot contain HTML.`);
  return v;
}

export async function submitFeedback(profileId: string, body: Record<string, unknown>) {
  if (!(await feedbackEnabled())) throw new HttpError(404, "Feedback is not available.");
  const type = body.type as EngagementFeedbackType;
  if (!APPLICANT_TYPES.includes(type)) throw new HttpError(422, "Unknown feedback type.");
  const message = plain(body.message, 5, 2000, "Message");
  const subject = body.subject ? plain(body.subject, 2, 120, "Subject") : null;
  let rating: number | null = null;
  if (body.rating !== undefined && body.rating !== null && body.rating !== "") {
    rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(422, "Rating must be 1 to 5.");
  }
  // 5 per hour is enforced at the route; this is a hard daily cap per applicant as a second line.
  const dayAgo = new Date(Date.now() - 86_400_000);
  if ((await prisma.engagementFeedback.count({ where: { profileId, createdAt: { gte: dayAgo } } })) >= 10) throw new HttpError(429, "Too much feedback today. Please try again tomorrow.");
  const code = await nextSequenceCode("EFB");
  const row = await prisma.engagementFeedback.create({ data: { code, profileId, type, subject, message, rating } });
  await engagementAudit({ action: "ENGAGEMENT_FEEDBACK_SUBMITTED", targetProfileId: profileId, resource: "engagement_feedback", resourceId: row.id, after: { code, type } });
  return { code: row.code, id: row.id };
}

export async function submitMeetingFollowup(profileId: string, body: Record<string, unknown>) {
  if (!(await feedbackEnabled())) throw new HttpError(404, "Feedback is not available.");
  const choice = body.choice as MeetingFollowupChoice;
  if (!(MEETING_FOLLOWUP_CHOICES as readonly string[]).includes(choice)) throw new HttpError(422, "Unknown choice.");
  const meetingId = typeof body.meetingId === "string" ? body.meetingId : "";
  if (!meetingId) throw new HttpError(422, "A meeting is required.");
  const note = body.note ? plain(body.note, 2, 500, "Note") : null;

  // the meeting must belong to one of THIS applicant's proposals and be completed; ownership comes from the session, not the body
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, status: "COMPLETED", proposal: { OR: [{ profileAId: profileId }, { profileBId: profileId }] } },
    select: { id: true, proposalId: true },
  });
  if (!meeting) throw new HttpError(404, "Meeting not found.");
  if (await prisma.engagementFeedback.findFirst({ where: { profileId, type: "MEETING_FOLLOWUP", refId: meeting.id }, select: { id: true } })) throw new HttpError(409, "You have already answered for this meeting.");

  const code = await nextSequenceCode("EFB");
  const row = await prisma.engagementFeedback.create({
    data: { code, profileId, type: "MEETING_FOLLOWUP", message: note ?? FEEDBACK_CHOICE_LABELS[choice].EN, choice, refType: "MEETING", refId: meeting.id },
  });
  // A staff task so a person follows up; the answer itself decides nothing.
  await createFromEvent({
    eventName: "engagement.MEETING_FOLLOWUP_CHOICE", dedupKey: `ENG:FU:${meeting.id}:${profileId}`, resourceType: "PROPOSAL", resourceId: meeting.proposalId,
    taskType: choice === "CONTACT_ADMIN" ? "SUPPORT_CASE_TASK" : "MEETING_FOLLOWUP", priority: "NORMAL", title: `Applicant follow-up choice recorded (${choice.replace(/_/g, " ").toLowerCase()})`,
  }).catch((e) => console.error("[engagement] follow-up task failed", e instanceof Error ? e.message : "error"));
  await engagementAudit({ action: "ENGAGEMENT_FEEDBACK_SUBMITTED", targetProfileId: profileId, resource: "engagement_feedback", resourceId: row.id, after: { code, type: "MEETING_FOLLOWUP", choice } });
  return { code: row.code, id: row.id };
}

// Completed meetings of this applicant that still have no follow-up answer (for the journey/feedback screens).
export async function listMeetingsAwaitingFollowup(profileId: string) {
  const mine = { OR: [{ profileAId: profileId }, { profileBId: profileId }] };
  const [meetings, answered] = await Promise.all([
    prisma.meeting.findMany({ where: { status: "COMPLETED", proposal: mine }, select: { id: true, scheduledAt: true }, orderBy: { scheduledAt: "desc" }, take: 20 }),
    prisma.engagementFeedback.findMany({ where: { profileId, type: "MEETING_FOLLOWUP" }, select: { refId: true } }),
  ]);
  const done = new Set(answered.map((a) => a.refId));
  return meetings.filter((m) => !done.has(m.id)).map((m) => ({ meetingId: m.id, scheduledAt: m.scheduledAt }));
}

export async function listMyFeedback(profileId: string) {
  const rows = await prisma.engagementFeedback.findMany({ where: { profileId }, orderBy: { createdAt: "desc" }, take: 50, select: { code: true, type: true, subject: true, status: true, createdAt: true, choice: true } });
  return rows;
}

// ----- staff side -----
export async function listFeedback(filter: { type?: string; status?: string; take?: number; cursor?: string | null }) {
  const take = Math.min(Math.max(filter.take ?? 50, 1), 100);
  const rows = await prisma.engagementFeedback.findMany({
    where: { ...(filter.type ? { type: filter.type as never } : {}), ...(filter.status ? { status: filter.status as never } : {}) },
    orderBy: { id: "desc" }, take: take + 1, ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, take);
  return { items: page, nextCursor: rows.length > take ? page[page.length - 1].id : null };
}

export async function handleFeedback(actor: SessionAdmin, id: string, patch: { status?: EngagementFeedbackStatus; internalNote?: string | null }) {
  const row = await prisma.engagementFeedback.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Feedback not found.");
  const status = patch.status;
  if (status && !["NEW", "IN_REVIEW", "RESOLVED", "ARCHIVED"].includes(status)) throw new HttpError(422, "Unknown status.");
  const internalNote = patch.internalNote === undefined ? undefined : patch.internalNote === null || patch.internalNote === "" ? null : plain(patch.internalNote, 2, 500, "Note");
  const updated = await prisma.engagementFeedback.update({ where: { id }, data: { ...(status ? { status } : {}), ...(internalNote !== undefined ? { internalNote } : {}), handledById: actor.id } });
  await engagementAudit({ action: "ENGAGEMENT_FEEDBACK_HANDLED", actorId: actor.id, targetProfileId: row.profileId, resource: "engagement_feedback", resourceId: id, before: { status: row.status }, after: { status: updated.status } });
  return updated;
}

// ----- surveys -----
export interface SurveyQuestion {
  id: string;
  text: string;
  type: "RATING" | "TEXT";
}

// Survey questions may never ask about marriage outcomes, and pass the same wording scan as everything else.
const OUTCOME_QUESTION = /(marri|nikah|shadi|engage(d|ment)|divorc|rishta (final|success)|compatib|پسند|شادی|نکاح)/i;

export function validateSurveyQuestions(raw: unknown): SurveyQuestion[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) throw new HttpError(422, "A survey needs 1-10 questions.");
  const seen = new Set<string>();
  const out: SurveyQuestion[] = raw.map((q, i) => {
    if (!q || typeof q !== "object") throw new HttpError(422, `Question ${i + 1} is invalid.`);
    const { id, text, type } = q as Record<string, unknown>;
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,30}$/i.test(id) || seen.has(id)) throw new HttpError(422, `Question ${i + 1} needs a unique id.`);
    seen.add(id);
    if (type !== "RATING" && type !== "TEXT") throw new HttpError(422, `Question ${i + 1} has an unknown type.`);
    const t = plain(text, 3, 300, `Question ${i + 1}`);
    if (OUTCOME_QUESTION.test(t)) throw new HttpError(422, `Question ${i + 1} cannot ask about marriage or match outcomes.`);
    return { id, text: t, type };
  });
  const scan = scanEngagementContent({ texts: out.map((q) => ({ field: `question.${q.id}`, text: q.text })) });
  if (!scan.pass) throw Object.assign(new HttpError(422, "A question conflicts with the engagement content policy."), { findings: scan.findings });
  return out;
}

export async function createSurvey(actor: SessionAdmin, input: { title: string; kind: string; questions: unknown }) {
  if (!(SURVEY_KINDS as readonly string[]).includes(input.kind)) throw new HttpError(422, "Unknown survey kind.");
  const title = plain(input.title, 3, 160, "Title");
  const questions = validateSurveyQuestions(input.questions);
  const code = await nextSequenceCode("ESV");
  const row = await prisma.engagementSurvey.create({ data: { code, title, kind: input.kind, questions: questions as never, createdById: actor.id } });
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_CHANGED", actorId: actor.id, resource: "engagement_survey", resourceId: row.id, after: { code, kind: input.kind } });
  return row;
}

// A survey goes live only through someone other than its author.
export async function setSurveyStatus(actor: SessionAdmin, id: string, status: "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED") {
  const s = await prisma.engagementSurvey.findUnique({ where: { id } });
  if (!s) throw new HttpError(404, "Survey not found.");
  if (status === "PUBLISHED" && actor.id === s.createdById) throw new HttpError(403, "A survey must be published by someone other than its author.");
  const updated = await prisma.engagementSurvey.update({ where: { id }, data: { status } });
  await engagementAudit({ action: "ENGAGEMENT_CONTENT_PUBLISHED", actorId: actor.id, resource: "engagement_survey", resourceId: id, after: { status } });
  return updated;
}

export async function listPublishedSurveys() {
  const rows = await prisma.engagementSurvey.findMany({ where: { status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, kind: true, questions: true } });
  return rows;
}

export async function submitSurveyResponse(profileId: string, surveyId: string, answers: unknown, refKey = "") {
  if (!(await feedbackEnabled())) throw new HttpError(404, "Feedback is not available.");
  const survey = await prisma.engagementSurvey.findUnique({ where: { id: surveyId } });
  if (!survey || survey.status !== "PUBLISHED") throw new HttpError(404, "Survey not found.");
  const questions = survey.questions as unknown as SurveyQuestion[];
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new HttpError(422, "Answers are required.");
  const given = answers as Record<string, unknown>;
  const clean: Record<string, string | number> = {};
  for (const q of questions) {
    const a = given[q.id];
    if (a === undefined || a === null || a === "") continue; // every question is optional
    if (q.type === "RATING") {
      const n = Number(a);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(422, "A rating must be 1 to 5.");
      clean[q.id] = n;
    } else clean[q.id] = plain(a, 1, 1000, "Answer");
  }
  if (!Object.keys(clean).length) throw new HttpError(422, "Please answer at least one question.");
  try {
    await prisma.engagementSurveyResponse.create({ data: { surveyId, profileId, refKey: refKey.slice(0, 60), answers: clean as never } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new HttpError(409, "You have already answered this survey.");
    throw error;
  }
  await engagementAudit({ action: "ENGAGEMENT_FEEDBACK_SUBMITTED", targetProfileId: profileId, resource: "engagement_survey", resourceId: surveyId, after: { answered: Object.keys(clean).length } });
  return { ok: true };
}

export async function surveyResults(id: string) {
  const s = await prisma.engagementSurvey.findUnique({ where: { id } });
  if (!s) throw new HttpError(404, "Survey not found.");
  const responses = await prisma.engagementSurveyResponse.findMany({ where: { surveyId: id }, select: { answers: true }, take: 5000 });
  const questions = s.questions as unknown as SurveyQuestion[];
  // aggregated only: the staff view never lists who said what
  const perQuestion = questions.map((q) => {
    const vals = responses.map((r) => (r.answers as Record<string, unknown>)[q.id]).filter((v) => v !== undefined);
    if (q.type === "RATING") {
      const nums = vals.map(Number).filter((n) => Number.isFinite(n));
      return { id: q.id, text: q.text, type: q.type, answered: nums.length, average: nums.length >= 5 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null, note: nums.length >= 5 ? null : "Not enough responses to show an average yet." };
    }
    return { id: q.id, text: q.text, type: q.type, answered: vals.length, average: null, note: null };
  });
  return { survey: { id: s.id, code: s.code, title: s.title, kind: s.kind, status: s.status }, responses: responses.length, perQuestion };
}
