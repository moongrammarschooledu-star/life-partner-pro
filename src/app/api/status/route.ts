import { NextResponse } from "next/server";
import { getPublicStatus } from "@/lib/platform/status";

export const dynamic = "force-dynamic";

// Public status: an overall state, short component states and published notices. Never an internal error, a provider name, a stack trace, a secret or a person.
// Fails to a neutral "unknown" so a database hiccup cannot make the status page itself report a false outage.
export async function GET() {
  try {
    return NextResponse.json(await getPublicStatus(), { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ enabled: true, state: "OPERATIONAL", headline: "Status is temporarily unavailable", message: "We could not read the current status. Please try again in a minute.", generatedAt: new Date().toISOString(), scheduledMaintenance: [], notices: [], contact: { email: null, hours: null }, platformName: "", timezone: "" }, { headers: { "Cache-Control": "no-store" } });
  }
}