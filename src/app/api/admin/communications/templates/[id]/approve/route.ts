import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { approveTemplate } from "@/lib/communications/template-service";

// The approver can never be the person who wrote that version (enforced in the service).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:templates:approve");
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await approveTemplate(admin, id, typeof body?.version === "number" ? body.version : undefined, typeof body?.note === "string" ? body.note.slice(0, 500) : undefined));
  } catch (error) {
    return handleApiError(error);
  }
}
