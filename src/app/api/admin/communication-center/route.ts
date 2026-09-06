import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

// Cross-profile search + history over the automated CommunicationLog
// (spec §11/§26) — distinct from the existing manual Communication log shown
// on a single profile's "Notes & Communication" tab.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("communication:view");
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");
    const profileCode = searchParams.get("profileCode");
    const proposalCode = searchParams.get("proposalCode");
    const channel = searchParams.get("channel");
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const includeTest = searchParams.get("includeTest") === "true";

    const where: Prisma.CommunicationLogWhereInput = {
      ...(channel ? { channel: channel as never } : {}),
      ...(status ? { deliveryStatus: status as never } : {}),
      ...(type ? { notificationType: type as never } : {}),
      ...(!includeTest ? { isTest: false } : {}),
      ...(dateFrom || dateTo ? { createdAt: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(dateTo) } : {}) } } : {}),
      ...(profileId ? { profileId } : {}),
      ...(profileCode ? { profile: { profileCode: { contains: profileCode, mode: "insensitive" } } } : {}),
      ...(proposalCode ? { proposal: { proposalCode: { contains: proposalCode, mode: "insensitive" } } } : {}),
    };

    const logs = await prisma.communicationLog.findMany({
      where,
      include: {
        profile: { select: { id: true, profileCode: true, fullName: true } },
        proposal: { select: { id: true, proposalCode: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const canViewBody = admin.permissions.includes("communication:message:view");
    const items = logs.map((log) => ({
      id: log.id,
      profile: log.profile,
      proposal: log.proposal,
      channel: log.channel,
      notificationType: log.notificationType,
      deliveryStatus: log.deliveryStatus,
      recipientReference: log.recipientReference,
      messageBody: canViewBody ? log.messageBody : null,
      isTest: log.isTest,
      retryCount: log.retryCount,
      failureReason: log.failureReason,
      createdBy: log.createdBy,
      sentAt: log.sentAt,
      deliveredAt: log.deliveredAt,
      readAt: log.readAt,
      createdAt: log.createdAt,
      providerMessageId: log.providerMessageId,
    }));

    return NextResponse.json({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
