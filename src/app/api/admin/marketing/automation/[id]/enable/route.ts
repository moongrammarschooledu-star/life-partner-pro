import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { setAutomationRuleEnabled } from "@/lib/marketing/automation";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Enabling needs a different admin than the rule's author (enforced in the service).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:automation:manage");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await setAutomationRuleEnabled(admin, id, b.enabled === true, str(b, "reason", { required: true, max: 300 })));
  } catch (error) {
    return marketingError(error);
  }
}
