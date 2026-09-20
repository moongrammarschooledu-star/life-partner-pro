import { NextResponse } from "next/server";
import { getPublicState } from "@/lib/ops/system-control";

export const dynamic = "force-dynamic";

// Tiny public endpoint read by proxy.ts (maintenance/emergency enforcement).
// Exposes only whether public traffic is blocked and the neutral message —
// no internals. Fails open: a DB hiccup must not make the site look "down".
export async function GET() {
  try {
    const state = await getPublicState();
    return NextResponse.json({ blocked: state.blocked, reason: state.reason, message: state.message }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ blocked: false, reason: "NONE", message: "" }, { headers: { "Cache-Control": "no-store" } });
  }
}
