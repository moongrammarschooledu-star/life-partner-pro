import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared result layout (spec §70) — every AI answer has the same shape:
// Summary / Evidence / Missing / Conflicts / Suggested next step / Limitations.
// Provider output is validated against this schema before it is trusted (§41).
// ---------------------------------------------------------------------------

export const INFO_SOURCES = ["VERIFIED", "USER_PROVIDED", "AI_OBSERVATION", "DATABASE"] as const;
export type InfoSource = (typeof INFO_SOURCES)[number];

export const SUFFICIENCY = ["SUFFICIENT", "PARTIAL", "LIMITED"] as const;
export type Sufficiency = (typeof SUFFICIENCY)[number];

export const FINDING_LABELS = ["MISSING", "INCONSISTENT", "NEEDS_VERIFICATION", "USER_CONFIRMATION_REQUIRED"] as const;
export type FindingLabel = (typeof FINDING_LABELS)[number];

const text = (max: number) => z.string().max(max);

export const evidenceSchema = z.object({
  label: text(80),
  value: text(300),
  source: z.enum(INFO_SOURCES),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const findingSchema = z.object({
  label: z.enum(FINDING_LABELS),
  area: text(80),
  message: text(300),
});
export type Finding = z.infer<typeof findingSchema>;

export const aiLayoutSchema = z.object({
  summary: text(2000),
  evidence: z.array(evidenceSchema).max(60),
  alignedAreas: z.array(text(300)).max(40),
  potentialConflicts: z.array(text(300)).max(40),
  missingInformation: z.array(text(300)).max(40),
  verificationQuestions: z.array(text(300)).max(30),
  suggestedNextStep: text(300).nullable(),
  limitations: z.array(text(300)).max(20),
});
export type AiLayout = z.infer<typeof aiLayoutSchema>;

// What a feature returns to the admin: the validated layout plus an
// information-sufficiency label (NEVER a probability of success, §35) and
// optional feature-specific structured data.
export interface AiPayload extends AiLayout {
  sufficiency: Sufficiency;
  findings?: Finding[];
  data?: Record<string, unknown>;
}

export interface AiLabels {
  generatedByAi: true;
  source: "Life Partner Pro database";
  generatedAt: string;
  aiVersion: string;
  promptVersion: string;
  provider: string;
  model: string;
  matchAlgorithmVersion: string;
}

export type AiOutcome =
  | { ok: true; payload: AiPayload; labels: AiLabels; requestId: string; fromCache: boolean; notices: string[] }
  | { ok: false; status: number; code: AiFailureCode; message: string; requestId?: string };

export type AiFailureCode =
  | "DISABLED"
  | "FORBIDDEN"
  | "CONSENT_REQUIRED"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INVALID_REQUEST"
  | "SAFETY_BLOCKED"
  | "UNAVAILABLE";

// ---------------------------------------------------------------------------
// Request inputs (validated at the API edge)
// ---------------------------------------------------------------------------

const id = z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const LANGUAGES = ["en", "ur", "roman-ur"] as const;
export type AiLanguage = (typeof LANGUAGES)[number];

export const profileSummaryInput = z.object({ profileId: id });
export const dataQualityInput = z.object({ profileId: id, mode: z.enum(["quality", "improvement"]).default("quality") });
export const matchExplanationInput = z.object({ profileAId: id, profileBId: id });
export const compareInput = z.object({ profileIds: z.array(id).min(2).max(4) });
export const proposalAssistanceInput = z.object({ profileAId: id, profileBId: id, proposalId: id.optional() });

export const COMMUNICATION_KINDS = [
  "PROPOSAL_MESSAGE",
  "INFORMATION_REQUEST",
  "FOLLOW_UP",
  "MEETING_COORDINATION",
  "REMINDER",
  "STATUS_UPDATE",
] as const;
export type CommunicationKind = (typeof COMMUNICATION_KINDS)[number];

export const communicationInput = z.object({
  profileId: id, // the recipient's profile
  kind: z.enum(COMMUNICATION_KINDS),
  language: z.enum(LANGUAGES).default("en"),
  proposalId: id.optional(),
});
export const followUpInput = z.object({ followUpId: id, language: z.enum(LANGUAGES).default("en") });
export const copilotInput = z.object({ message: z.string().trim().min(2).max(500), profileId: id.optional() });
export const reportInput = z.object({
  report: z.enum(["registrations", "proposals", "followups", "verification", "support"]),
  days: z.number().int().min(1).max(365).default(30),
});
