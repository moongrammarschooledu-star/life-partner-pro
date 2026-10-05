import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { getEngagementSettings, updateEngagementSettings } from "@/lib/engagement/settings";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

// Frequency limits, attempt caps, inactivity thresholds and default quiet hours - all editable here, none hard-coded.
export async function GET() {
  try {
    await requireAdmin("engagement:view");
    return NextResponse.json(await getEngagementSettings(), { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("engagement:manage");
    const b = await readBody(req);
    const { reason, ...patch } = b;
    return NextResponse.json(await updateEngagementSettings(admin.id, patch, str({ reason }, "reason", { required: true, max: 300 })));
  } catch (error) {
    return marketingError(error);
  }
}
