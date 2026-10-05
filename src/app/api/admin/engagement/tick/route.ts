import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { runEngagementTick } from "@/lib/engagement/tick";
import { marketingError } from "@/lib/marketing/route-utils";

// Manual "run now" for the daily engagement lifecycle. It can only record events, advance already-published workflows and ask the
// preflight gate to deliver due reminders - see src/lib/engagement/tick.ts.
export async function POST() {
  try {
    await requireAdmin("engagement:manage");
    return NextResponse.json(await runEngagementTick());
  } catch (error) {
    return marketingError(error);
  }
}
