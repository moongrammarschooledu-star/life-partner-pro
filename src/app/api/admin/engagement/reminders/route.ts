import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { listReminders } from "@/lib/engagement/reminders";
import { marketingError, noStore, pageParams } from "@/lib/marketing/route-utils";

export async function GET(req: Request) {
  try {
    await requireAdmin("engagement:reminders:view");
    const { cursor, take } = pageParams(req.url);
    const state = new URL(req.url).searchParams.get("state") ?? undefined;
    return NextResponse.json(await listReminders({ state, take, cursor }), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}
