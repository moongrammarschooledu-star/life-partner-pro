import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { runMarketingTick } from "@/lib/marketing/tick";
import { marketingError } from "@/lib/marketing/route-utils";

// Manual "run now" for the daily marketing lifecycle (scheduled starts/ends, provider metric sync, automation sweep).
// It cannot launch an unapproved campaign, raise a budget or spend anything — see src/lib/marketing/tick.ts.
export async function POST() {
  try {
    await requireAdmin("marketing:ads:manage");
    return NextResponse.json(await runMarketingTick());
  } catch (error) {
    return marketingError(error);
  }
}
