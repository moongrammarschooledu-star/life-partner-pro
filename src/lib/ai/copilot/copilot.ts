import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import type { AiOutcome, AiPayload, Evidence } from "@/lib/ai/types";
import { runAiRequest } from "@/lib/ai/pipeline";
import { auditAi } from "@/lib/ai/record";
import { STANDARD_LIMITATIONS } from "@/lib/ai/analysis/summary";
import { routeIntent, type ToolRequest } from "@/lib/ai/copilot/intent";
import { executeTool, type ToolOutput } from "@/lib/ai/copilot/tools";

// Spec §16/§17/§43 — Life Partner Pro Admin Copilot. Every answer is built
// from tool outputs that were each authorised against THIS admin's own
// permissions; a tool the admin cannot use produces a "no access" line (and an
// AI_DATA_ACCESS_DENIED audit event), never data. The Copilot is read/draft
// only.

const union = (lists: Array<string[] | undefined>, max: number) => [...new Set(lists.flatMap((l) => l ?? []))].slice(0, max);

async function runTool(admin: SessionAdmin, req: ToolRequest): Promise<{ out?: ToolOutput; denied?: string }> {
  try {
    return { out: await executeTool(req.tool, req.args, admin) };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 400)) {
      if (err.status === 403) await auditAi("AI_DATA_ACCESS_DENIED", admin.id, { feature: "COPILOT", tool: req.tool });
      return { denied: err.status === 403 ? "You do not have access to that information." : "That request could not be understood safely." };
    }
    throw err;
  }
}

export function composeCopilotPayload(parts: { outputs: ToolOutput[]; denied: string[]; refusal?: string; help?: string }): AiPayload {
  const { outputs, denied, refusal, help } = parts;
  const summary = refusal ?? help ?? ([...outputs.map((o) => o.heading), ...denied].filter(Boolean).join(" ") || "No answer could be produced.");
  const evidence: Evidence[] = outputs.flatMap((o) => o.lines).slice(0, 60);
  return {
    summary: summary.slice(0, 1900),
    evidence,
    alignedAreas: [],
    potentialConflicts: union(outputs.map((o) => o.conflicts), 40),
    missingInformation: union(outputs.map((o) => o.missing), 40),
    verificationQuestions: union(outputs.map((o) => o.questions), 30),
    suggestedNextStep: outputs.find((o) => o.next)?.next ?? null,
    limitations: [...STANDARD_LIMITATIONS, "The Copilot only answers from data you are authorised to see, and can only read or draft — it cannot send, approve, share, delete, suspend, refund or finalise anything."],
    sufficiency: outputs.length ? "PARTIAL" : "LIMITED",
    data: {
      toolsUsed: outputs.length,
      refused: Boolean(refusal),
      denied: denied.length,
      // Any draft produced by draftMessage travels here for the UI to show, unsent.
      drafts: outputs.map((o) => (o.data as { draft?: unknown } | undefined)?.draft).filter(Boolean),
    },
  };
}

export async function runCopilot(admin: SessionAdmin, message: string, contextProfileId?: string): Promise<AiOutcome> {
  return runAiRequest({
    admin,
    feature: "COPILOT",
    profileIds: contextProfileId ? [contextProfileId] : [],
    language: "en",
    extraCacheParts: { message },
    build: async (ctx) => {
      const routed = routeIntent(message, ctx.loaded[0]?.view.profileCode ?? null);
      if (routed.kind === "refusal") return { payload: composeCopilotPayload({ outputs: [], denied: [], refusal: routed.message }) };
      if (routed.kind === "help") return { payload: composeCopilotPayload({ outputs: [], denied: [], help: routed.message }) };
      const outputs: ToolOutput[] = [];
      const denied: string[] = [];
      for (const req of routed.requests.slice(0, 3)) {
        const r = await runTool(admin, req);
        if (r.out) outputs.push(r.out);
        if (r.denied) denied.push(r.denied);
      }
      return { payload: composeCopilotPayload({ outputs, denied }) };
    },
  });
}
