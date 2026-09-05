import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import type { NotificationChannel, Locale } from "@prisma/client";

export async function GET() {
  try {
    await requireAdmin("communication:view");
    const overrides = await prisma.notificationTemplate.findMany({
      include: { updatedBy: { select: { name: true } } },
      orderBy: [{ event: "asc" }, { channel: "asc" }, { language: "asc" }],
    });
    return NextResponse.json({ items: overrides });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("notification:template:manage");
    const { name, event, channel, language, subject, message, variables } = await req.json();

    if (!name || !event || !channel || !language || !message) {
      throw new ApiError(400, "name, event, channel, language, and message are required");
    }

    const template = await prisma.notificationTemplate.upsert({
      where: { event_channel_language: { event, channel: channel as NotificationChannel, language: language as Locale } },
      update: { name, subject: subject || null, message, variables: Array.isArray(variables) ? variables : [], updatedById: admin.id },
      create: {
        name,
        event,
        channel,
        language,
        subject: subject || null,
        message,
        variables: Array.isArray(variables) ? variables : [],
        updatedById: admin.id,
      },
    });

    await writeAudit({ action: "NOTIFICATION_TEMPLATE_UPDATED", adminId: admin.id, meta: { event, channel, language } });

    return NextResponse.json(template);
  } catch (error) {
    return handleApiError(error);
  }
}
