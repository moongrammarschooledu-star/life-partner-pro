import type { EngagementSnapshot } from "@/lib/engagement/types";

// STEP 30 — Engagement Activity Score (pure). It describes PLATFORM ACTIVITY only: how much of the applicant's own
// onboarding and responding they have done recently. It is NOT a personality, compatibility, attractiveness, trust or
// marriage-likelihood measure, and it is deliberately kept out of every decision path:
//   - it is computed on read, never stored, never shown to the applicant;
//   - no workflow condition, announcement target, re-engagement rule or AI input can reference it (the closed schemas
//     have no such field, and security.test.ts scans for it);
//   - it must never be used to rank, filter, prioritise or treat applicants differently.

export interface ActivityComponent {
  key: "PROFILE_COMPLETION" | "RECENT_ACTIVITY" | "VERIFICATION_PROGRESS" | "PROPOSAL_RESPONSIVENESS" | "MEETING_CONFIRMATION" | "TASK_COMPLETION";
  label: string;
  weight: number;
  // 0..1, or null when there is nothing to measure yet (the component is then left out and the rest re-weighted)
  value: number | null;
}

export interface ActivityScore {
  score: number | null;
  components: ActivityComponent[];
  note: string;
}

export const ACTIVITY_SCORE_NOTE = "Platform activity only (not a quality, compatibility or suitability measure). Never used to rank, filter or treat applicants differently.";

export function daysSince(date: Date | null, now: Date): number | null {
  return date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
}

export function computeActivityScore(s: EngagementSnapshot): ActivityScore {
  const idle = daysSince(s.lastActivityAt, s.now);
  const recent = idle === null ? null : idle <= 7 ? 1 : idle <= 14 ? 0.7 : idle <= 30 ? 0.4 : idle <= 60 ? 0.15 : 0;
  const verification = s.profile.verified ? 1 : ["VERIFICATION_PENDING", "UNDER_REVIEW"].includes(s.verification.status) ? 0.5 : 0;
  const responsiveness = s.proposals.received > 0 ? Math.min(1, s.proposals.responded / s.proposals.received) : null;
  const meetingTotal = s.meetings.awaitingConfirmation + s.meetings.scheduled + s.meetings.completed;
  const meeting = meetingTotal > 0 ? (s.meetings.scheduled + s.meetings.completed) / meetingTotal : null;

  const components: ActivityComponent[] = [
    { key: "PROFILE_COMPLETION", label: "Profile completion", weight: 30, value: Math.max(0, Math.min(1, s.profile.completion / 100)) },
    { key: "RECENT_ACTIVITY", label: "Recent activity", weight: 25, value: recent },
    { key: "VERIFICATION_PROGRESS", label: "Verification progress", weight: 15, value: verification },
    { key: "PROPOSAL_RESPONSIVENESS", label: "Responses to proposals received", weight: 15, value: responsiveness },
    { key: "MEETING_CONFIRMATION", label: "Meeting confirmations", weight: 10, value: meeting },
    { key: "TASK_COMPLETION", label: "Requested items completed", weight: 5, value: s.completedTasksRatio },
  ];

  const measured = components.filter((c) => c.value !== null);
  const totalWeight = measured.reduce((n, c) => n + c.weight, 0);
  // fewer than three measurable components is not enough to say anything
  if (measured.length < 3 || totalWeight === 0) return { score: null, components, note: ACTIVITY_SCORE_NOTE };
  const score = Math.round((measured.reduce((n, c) => n + c.weight * (c.value as number), 0) / totalWeight) * 100);
  return { score, components, note: ACTIVITY_SCORE_NOTE };
}

export type ActivityBand = "ACTIVE" | "LOW_ACTIVITY" | "INACTIVE";

// Activity BAND from days idle and the admin-configured thresholds. A band says "has not used the platform recently";
// it is never a statement about the person (not "uninterested", "unsuitable" or "unlikely to marry").
export function activityBand(idleDays: number | null, lowAfterDays: number, inactiveAfterDays: number): ActivityBand {
  if (idleDays === null) return "ACTIVE";
  if (idleDays >= inactiveAfterDays) return "INACTIVE";
  if (idleDays >= lowAfterDays) return "LOW_ACTIVITY";
  return "ACTIVE";
}
