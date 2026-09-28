import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { RESOURCE_TYPES, addInternalComment } from "@/lib/communications/thread-service";
import { oneOf, readJson, str } from "@/lib/communications/route-utils";

// Internal comment on a record (proposal, case, profile ...). Never visible to an applicant or family member:
// PUBLIC_TO_USER is downgraded to INTERNAL_ONLY by the service, and the default is INTERNAL_ONLY.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:send");
    const body = await readJson(req);
    const visibility = body.visibility === undefined ? undefined : oneOf(body.visibility, ["INTERNAL_ONLY", "STAFF_SHARED", "MANAGER_ONLY"] as const, "visibility");
    const message = await addInternalComment(admin, {
      resourceType: oneOf(body.resourceType, RESOURCE_TYPES, "resourceType"),
      resourceId: str(body.resourceId, "resourceId", { max: 60 }),
      profileId: str(body.profileId, "profileId", { max: 60, optional: true }) || null,
      body: str(body.body, "body", { max: 2000 }),
      visibility,
    });
    return NextResponse.json({ id: message.id }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
