import { ACTION_PHRASES, NEXT_ACTION_DISCLAIMER, type Lang } from "@/lib/engagement/phrases";
import type { EngagementSnapshot, NextAction } from "@/lib/engagement/types";

// STEP 30 — NextActionService (pure). Looks only at what is OPEN on the account and explains why, in fixed neutral wording.
// It never invents urgency, never compares the applicant to anyone, never predicts anything, and never recommends a
// matrimonial decision (it can say "review a proposal", never "accept"). The list is ordered, not ranked by pressure.

const INACTIVE_PROFILE_STATUSES = ["SUSPENDED", "ARCHIVED", "REJECTED", "MARRIED", "FINALIZED", "NOT_INTERESTED"];
const VERIFICATION_OPEN = ["NOT_VERIFIED", "VERIFICATION_PENDING", "VERIFICATION_REQUIRED", "RE_VERIFICATION_REQUIRED", "VERIFICATION_EXPIRED"];

export function computeNextActions(s: EngagementSnapshot, opts: { limit?: number } = {}): NextAction[] {
  const lang: Lang = s.language;
  const out: Omit<NextAction, "order">[] = [];
  const add = (key: string, href: string, ctx: { items?: string; count?: number } = {}) => {
    const p = ACTION_PHRASES[key];
    out.push({ key, href, title: p.title[lang], reason: p.reason(ctx)[lang] });
  };

  if (s.profile.softDeleted || INACTIVE_PROFILE_STATUSES.includes(s.profile.status)) return [];

  if (s.proposals.awaitingMyResponse > 0) add("RESPOND_TO_PROPOSAL", "/my-proposals", { count: s.proposals.awaitingMyResponse });
  if (s.meetings.awaitingConfirmation > 0) add("CONFIRM_MEETING", "/my-proposals", { count: s.meetings.awaitingConfirmation });
  if (s.verification.requestedInfoCount > 0) add("PROVIDE_REQUESTED_INFORMATION", "/my-verification", { count: s.verification.requestedInfoCount });
  if (s.profile.completion < 100) add("COMPLETE_PROFILE", "/dashboard/profile/edit", { items: s.missingSections.slice(0, 4).join(", ") });
  if (!s.hasPhoto) add("ADD_PHOTO", "/dashboard/profile/photos");
  if (!s.profile.verified && VERIFICATION_OPEN.includes(s.verification.status) && s.verification.requestedInfoCount === 0) add("COMPLETE_VERIFICATION", "/my-verification");
  if (!s.hasPartnerRequirements) add("REVIEW_PARTNER_REQUIREMENTS", "/dashboard/profile/partner-requirements");
  if (s.meetings.completedAwaitingFollowup > 0) add("SHARE_MEETING_FEEDBACK", "/dashboard/feedback");
  if (!s.hasNotificationPreferences) add("REVIEW_PRIVACY_SETTINGS", "/dashboard/settings/notifications");
  if (s.openCases === 0 && s.verification.status === "VERIFICATION_REJECTED") add("CONTACT_SUPPORT", "/support");

  return out.slice(0, opts.limit ?? 6).map((a, i) => ({ ...a, order: i + 1 }));
}

export function nextActionDisclaimer(lang: Lang): string {
  return NEXT_ACTION_DISCLAIMER[lang];
}
