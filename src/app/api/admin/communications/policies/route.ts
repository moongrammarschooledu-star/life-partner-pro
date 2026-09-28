import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { effectivePolicies } from "@/lib/communications/log-service";

// The effective (active, versioned) communication policies: frequency limits, quiet hours, jurisdiction defaults, environment
// settings and the follow-up automation rules.
export async function GET() {
  try {
    await requireAdmin("communications:providers:view");
    return NextResponse.json(await effectivePolicies());
  } catch (error) {
    return handleApiError(error);
  }
}
