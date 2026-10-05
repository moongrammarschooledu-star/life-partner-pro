import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { cancelReminder } from "@/lib/engagement/reminders";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("engagement:reminders:manage");
    const { id } = await params;
    const b = await readBody(req);
    const r = await cancelReminder(id, str(b, "reason", { required: true, max: 200 }), admin.id);
    return NextResponse.json({ id: r.id, state: r.state });
  } catch (error) {
    return marketingError(error);
  }
}
