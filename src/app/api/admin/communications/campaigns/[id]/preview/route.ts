import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { previewAudience } from "@/lib/communications/campaign-service";

// Audience size plus a policy-engine dry run on a sample. Counts and a few profile codes only - no names, no contact details.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:campaigns:view");
    const { id } = await params;
    return NextResponse.json(await previewAudience(admin, id));
  } catch (error) {
    return handleApiError(error);
  }
}
