import { NextResponse } from "next/server";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { RESOURCE_TYPES, USER_THREAD_TYPES, createThread, listStaffThreads, type ThreadResourceType } from "@/lib/communications/thread-service";
import { oneOf, optionalOneOf, readJson, str, takeParam } from "@/lib/communications/route-utils";

export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("communications:view");
    const q = new URL(req.url).searchParams;
    const items = await listStaffThreads(admin, {
      type: optionalOneOf(q.get("type"), [...USER_THREAD_TYPES, "INTERNAL_ADMIN_THREAD"] as const, "type") as never,
      profileId: q.get("profileId") ?? undefined,
      status: optionalOneOf(q.get("status"), ["OPEN", "CLOSED", "ARCHIVED"] as const, "status"),
      take: takeParam(q.get("take")),
    });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

// A conversation has AT MOST ONE applicant. There is no thread type or parameter that connects two applicants.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:send");
    const body = await readJson(req);
    const resourceType = body.resourceType ? (oneOf(body.resourceType, RESOURCE_TYPES, "resourceType") as ThreadResourceType) : null;
    if (body.familyMemberIds !== undefined && (!Array.isArray(body.familyMemberIds) || body.familyMemberIds.some((x) => typeof x !== "string"))) throw new ApiError(400, "familyMemberIds must be a list of ids.");
    const thread = await createThread(admin, {
      type: oneOf(body.type, [...USER_THREAD_TYPES, "INTERNAL_ADMIN_THREAD"] as const, "type") as never,
      subject: str(body.subject, "subject", { max: 160 }),
      resourceType,
      resourceId: str(body.resourceId, "resourceId", { max: 60, optional: true }) || null,
      profileId: str(body.profileId, "profileId", { max: 60, optional: true }) || null,
      familyMemberIds: body.familyMemberIds as string[] | undefined,
    });
    return NextResponse.json({ id: thread.id, threadCode: thread.threadCode }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
