import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { postStaffMessage } from "@/lib/communications/thread-service";
import { oneOf, readJson, str } from "@/lib/communications/route-utils";

// Default visibility is INTERNAL_ONLY: a message reaches the applicant only when staff explicitly choose PUBLIC_TO_USER.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("communications:send");
    const { id } = await params;
    const body = await readJson(req);
    const visibility = body.visibility === undefined ? undefined : oneOf(body.visibility, ["PUBLIC_TO_USER", "INTERNAL_ONLY", "STAFF_SHARED", "MANAGER_ONLY"] as const, "visibility");
    const message = await postStaffMessage(admin, id, { body: str(body.body, "body", { max: 2000 }), visibility });
    return NextResponse.json({ id: message.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
