import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";

export async function POST() {
  try {
    const admin = await requireAdmin();
    await prisma.notification.updateMany({ where: { recipientAdminId: admin.id, readAt: null }, data: { readAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
