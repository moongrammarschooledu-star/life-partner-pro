import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/default-templates";
import { SAFE_VARIABLES } from "@/lib/notifications/template-resolver";

// Read-only reference for the template editor UI — shows the built-in
// fallback copy an override would replace, and the safe variable allow-list.
export async function GET() {
  try {
    await requireAdmin("communication:view");
    return NextResponse.json({ defaults: DEFAULT_TEMPLATES, safeVariables: SAFE_VARIABLES });
  } catch (error) {
    return handleApiError(error);
  }
}
