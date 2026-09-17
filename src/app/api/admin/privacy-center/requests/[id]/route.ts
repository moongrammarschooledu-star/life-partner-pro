import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { resolvePrivacyRequest } from "@/lib/privacy/privacy-request";
import { notifyPrivacyRequestUpdated } from "@/lib/notifications/events";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin("privacy:requests:view");
    const { id } = await params;
    const request = await prisma.privacyRequest.findUnique({ where: { id }, include: { profile: { select: { fullName: true, profileCode: true } } } });
    if (!request) throw new ApiError(404, "Privacy request not found");
    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin("privacy:requests:manage");
    const { id } = await params;
    const { status, resolutionNote } = await req.json();

    const request = await resolvePrivacyRequest({ requestId: id, adminId: admin.id, status, resolutionNote });
    await notifyPrivacyRequestUpdated(request.profileId, request.requestCode);

    return NextResponse.json(request);
  } catch (error) {
    return handleApiError(error);
  }
}
