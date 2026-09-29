import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { createRequest, listRequests } from "@/lib/documents/request-service";
import { oneOf, optionalOneOf, str, dateParam, takeParam } from "@/lib/documents/route-utils";

const REQUESTED_FROM_TYPES = ["PROFILE", "FAMILY_MEMBER"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export async function GET(req: Request) {
  try {
    await requireAdmin("documents:manage_requests");
    const q = new URL(req.url).searchParams;
    const items = await listRequests({ status: q.get("status") ?? undefined, requestedFromId: q.get("requestedFromId") ?? undefined, take: takeParam(q.get("take")) });
    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("documents:manage_requests");
    const body = await req.json().catch(() => ({}));
    const request = await createRequest(admin, {
      typeKey: str(body.typeKey, "typeKey", { max: 60 }),
      purpose: str(body.purpose, "purpose", { max: 500 }),
      requestedFromType: oneOf(body.requestedFromType, REQUESTED_FROM_TYPES, "requestedFromType"),
      requestedFromId: str(body.requestedFromId, "requestedFromId", { max: 60 }),
      dueDate: dateParam(body.dueDate, "dueDate"),
      priority: optionalOneOf(body.priority, PRIORITIES, "priority"),
      instructions: body.instructions ? str(body.instructions, "instructions", { max: 2000 }) : undefined,
      assignedToId: body.assignedToId ? str(body.assignedToId, "assignedToId", { max: 60 }) : undefined,
    });
    return NextResponse.json(request, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
