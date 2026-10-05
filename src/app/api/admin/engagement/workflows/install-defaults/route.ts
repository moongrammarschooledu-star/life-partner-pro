import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { installDefaultWorkflows } from "@/lib/engagement/workflow-service";
import { marketingError } from "@/lib/marketing/route-utils";

// Installs the standard lifecycle automations as DRAFTS. Nothing runs until each one is reviewed by a different person and published.
export async function POST() {
  try {
    const admin = await requireAdmin("engagement:workflows:create");
    return NextResponse.json(await installDefaultWorkflows(admin), { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}
