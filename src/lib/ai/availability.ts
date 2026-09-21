import type { AiFeature } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import type { AiConfigValues } from "@/lib/ai/config";

// Spec §57/§58/§59 — whether AI is usable at all for THIS admin and feature.
// Pure so it can be tested exhaustively; the async wrapper loads config/flags.

export const FEATURE_FLAG_FOR: Record<AiFeature, string> = {
  PROFILE_SUMMARY: "ai.profile_summary.enabled",
  MATCH_EXPLANATION: "ai.match_explanation.enabled",
  COMPARE: "ai.compare.enabled",
  PROPOSAL_ASSISTANT: "ai.proposal_assistant.enabled",
  COMMUNICATION_ASSISTANT: "ai.communication_assistant.enabled",
  FOLLOWUP_ASSISTANT: "ai.followup_assistant.enabled",
  COPILOT: "ai.copilot.enabled",
  REPORT_ASSISTANT: "ai.report_assistant.enabled",
  DATA_QUALITY: "ai.profile_summary.enabled",
  PROFILE_IMPROVEMENT: "ai.profile_summary.enabled",
};

export const PERMISSION_FOR: Record<AiFeature, Permission> = {
  PROFILE_SUMMARY: "ai:use",
  MATCH_EXPLANATION: "ai:use",
  COMPARE: "ai:use",
  PROPOSAL_ASSISTANT: "ai:use",
  COMMUNICATION_ASSISTANT: "ai:communication:draft",
  FOLLOWUP_ASSISTANT: "ai:communication:draft",
  COPILOT: "ai:copilot",
  REPORT_ASSISTANT: "ai:report:use",
  DATA_QUALITY: "ai:use",
  PROFILE_IMPROVEMENT: "ai:use",
};

export type UnavailableReason = "KILL_SWITCH" | "PHASE_DISABLED" | "NOT_IN_ROLLOUT" | "FLAG_OFF" | "PROVIDER_DISABLED" | "NO_PERMISSION";

export interface AdminLike {
  id: string;
  role: string;
  permissions: Permission[];
}

export function evaluateAvailability(params: {
  config: Pick<AiConfigValues, "phase" | "killSwitchActive" | "provider" | "pilotAdminIds">;
  flags: Record<string, boolean>;
  admin: AdminLike;
  feature: AiFeature;
}): { available: true } | { available: false; reason: UnavailableReason } {
  const { config, flags, admin, feature } = params;

  if (config.killSwitchActive) return { available: false, reason: "KILL_SWITCH" };
  if (config.phase === "DISABLED") return { available: false, reason: "PHASE_DISABLED" };
  if (config.provider === "DISABLED") return { available: false, reason: "PROVIDER_DISABLED" };
  if (!admin.permissions.includes(PERMISSION_FOR[feature])) return { available: false, reason: "NO_PERMISSION" };
  if (!flags["ai.enabled"] || !flags[FEATURE_FLAG_FOR[feature]]) return { available: false, reason: "FLAG_OFF" };

  const isSuper = admin.role === "SUPER_ADMIN";
  const isPilot = config.pilotAdminIds.includes(admin.id);
  let inRollout: boolean;
  switch (config.phase) {
    case "INTERNAL_TEST":
      inRollout = isSuper;
      break;
    case "STAFF_PILOT":
      inRollout = isSuper || isPilot;
      break;
    case "LIMITED_PRODUCTION":
      inRollout = isSuper || admin.role === "ADMIN" || isPilot;
      break;
    default:
      inRollout = true; // PRODUCTION — anyone holding the permission
  }
  return inRollout ? { available: true } : { available: false, reason: "NOT_IN_ROLLOUT" };
}

export const UNAVAILABLE_MESSAGE: Record<UnavailableReason, string> = {
  KILL_SWITCH: "AI assistance is temporarily unavailable.",
  PHASE_DISABLED: "AI assistance is not currently enabled.",
  NOT_IN_ROLLOUT: "AI assistance is not yet available to your account.",
  FLAG_OFF: "This AI feature is not currently enabled.",
  PROVIDER_DISABLED: "AI assistance is not currently enabled.",
  NO_PERMISSION: "You do not have permission to use this AI feature.",
};
