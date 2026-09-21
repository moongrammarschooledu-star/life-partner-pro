import { NextResponse } from "next/server";
import type { AiOutcome } from "@/lib/ai/types";

// One place that turns a pipeline outcome into an HTTP response. Failures carry
// only a neutral message and a code — never a provider error, a stack or any
// data. AI results are never cached by browsers or proxies.
export function outcomeResponse(outcome: AiOutcome): NextResponse {
  const headers = { "Cache-Control": "no-store" };
  if (outcome.ok) {
    return NextResponse.json(
      {
        ok: true,
        result: outcome.payload,
        labels: outcome.labels,
        requestId: outcome.requestId,
        fromCache: outcome.fromCache,
        notices: outcome.notices,
        disclaimer: "AI recommends and explains. A human decides. This is not a verified record.",
      },
      { headers }
    );
  }
  return NextResponse.json({ ok: false, code: outcome.code, error: outcome.message, requestId: outcome.requestId ?? null }, { status: outcome.status, headers });
}
