import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { activateTemplate } from "@/lib/communications/template-service";

// Activating an external-facing or marketing template goes through the STEP 19 approval gate; the response says when approval is pending.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:templates:activate");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await activateTemplate(admin, id, typeof body?.version === "number" ? body.version : undefined);
    return NextResponse.json(result, { status: result.approvalRequired ? 202 : 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
