import { ALGORITHM_VERSION } from "@/lib/matching";

// Spec §27 — every AI result records which of these produced it, so a
// historical explanation can be reproduced or reviewed.
export const AI_VERSION = "LPP-AI-v1.0";
export const MATCH_ALGORITHM_VERSION = ALGORITHM_VERSION; // deterministic matcher, unchanged by AI
export const TEST_SUITE_VERSION = "LPP-AI-TESTS-v1.0";

// Spec §65 — versioned prompt templates. The RULES provider is template-driven
// and records the same ids so history stays uniform across providers.
export const PROMPT_VERSIONS = {
  PROFILE_SUMMARY: "LPP-AI-PROFILE-SUMMARY-v1.0",
  MATCH_EXPLANATION: "LPP-AI-MATCH-EXPLANATION-v1.0",
  COMPARE: "LPP-AI-COMPARE-v1.0",
  PROPOSAL_ASSISTANT: "LPP-AI-PROPOSAL-v1.0",
  COMMUNICATION_ASSISTANT: "LPP-AI-COMMUNICATION-v1.0",
  FOLLOWUP_ASSISTANT: "LPP-AI-FOLLOWUP-v1.0",
  COPILOT: "LPP-AI-COPILOT-v1.0",
  REPORT_ASSISTANT: "LPP-AI-REPORT-v1.0",
  DATA_QUALITY: "LPP-AI-DATA-QUALITY-v1.0",
  PROFILE_IMPROVEMENT: "LPP-AI-PROFILE-IMPROVEMENT-v1.0",
} as const;

export type AiFeatureKey = keyof typeof PROMPT_VERSIONS;
