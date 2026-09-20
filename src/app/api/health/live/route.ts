import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness (spec §11): "is the process running?" — deliberately touches no
// dependency, so a database outage can never make the app look dead.
export async function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
