import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { updateAutomationRule } from "@/lib/marketing/automation";
import { marketingError, readBody, str } from "@/lib/marketing/route-utils";

// Editing a rule bumps its version and DISABLES it; a different admin must enable it again.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("marketing:automation:manage");
    const { id } = await params;
    const b = await readBody(req);
    return NextResponse.json(await updateAutomationRule(admin, id, { name: str(b, "name", { max: 120 }) || undefined, conditions: b.conditions, actions: b.actions }));
  } catch (error) {
    return marketingError(error);
  }
}
