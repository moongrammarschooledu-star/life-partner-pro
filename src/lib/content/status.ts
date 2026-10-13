import type { ContentStatus } from "@prisma/client";

// The publishing workflow for blog articles and guides. Pure, so every rule is tested.
//
//   DRAFT ──submit──▶ IN_REVIEW ──publish──▶ PUBLISHED ──archive──▶ ARCHIVED
//     │                  │                        ▲                      │
//     │                  └──schedule──▶ SCHEDULED ┘ (shown from its date)  └──restore──▶ DRAFT
//     └──publish / schedule directly (allowed only when no second reviewer is required)
//
// A SCHEDULED item becomes visible when its date passes. Nothing has to run at that moment: public pages simply treat
// "scheduled and due" as published, so scheduling works on a plan with only a daily cron.

export type ContentAction = "SUBMIT" | "PUBLISH" | "SCHEDULE" | "UNSCHEDULE" | "ARCHIVE" | "RESTORE" | "REQUEST_CHANGES";

const TRANSITIONS: Record<ContentAction, { from: ContentStatus[]; to: ContentStatus }> = {
  SUBMIT: { from: ["DRAFT"], to: "IN_REVIEW" },
  REQUEST_CHANGES: { from: ["IN_REVIEW"], to: "DRAFT" },
  PUBLISH: { from: ["DRAFT", "IN_REVIEW", "SCHEDULED"], to: "PUBLISHED" },
  SCHEDULE: { from: ["DRAFT", "IN_REVIEW"], to: "SCHEDULED" },
  UNSCHEDULE: { from: ["SCHEDULED"], to: "DRAFT" },
  ARCHIVE: { from: ["PUBLISHED", "SCHEDULED", "DRAFT", "IN_REVIEW"], to: "ARCHIVED" },
  RESTORE: { from: ["ARCHIVED"], to: "DRAFT" },
};

export function nextStatus(action: ContentAction, from: ContentStatus): ContentStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(from) ? rule.to : null;
}

/** Which permission an action needs. Submitting and requesting changes are editing; going live and archiving are separate grants. */
export function permissionForAction(action: ContentAction): "content:edit" | "content:publish" | "content:archive" {
  if (action === "SUBMIT" || action === "REQUEST_CHANGES" || action === "UNSCHEDULE") return "content:edit";
  if (action === "ARCHIVE" || action === "RESTORE") return "content:archive";
  return "content:publish";
}

/** When review is required, whoever last changed the article may not be the one who publishes or schedules it. */
export function selfPublishBlocked(params: { approvalRequired: boolean; actorId: string; lastEditorId: string; action: ContentAction }): boolean {
  if (!params.approvalRequired) return false;
  if (params.action !== "PUBLISH" && params.action !== "SCHEDULE") return false;
  return params.actorId === params.lastEditorId;
}

export function isDeletable(status: ContentStatus): boolean {
  return status === "DRAFT" || status === "ARCHIVED";
}

/** Public visibility: published, or scheduled and already due. */
export function isLive(post: { status: ContentStatus; scheduledFor: Date | null }, now: Date): boolean {
  if (post.status === "PUBLISHED") return true;
  return post.status === "SCHEDULED" && post.scheduledFor !== null && post.scheduledFor <= now;
}
