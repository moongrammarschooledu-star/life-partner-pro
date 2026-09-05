import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";

// Deliberately named apart from /api/admin/notifications (the existing
// computed "action needed" aggregate, untouched) — this is the persisted,
// per-admin Notification-backed inbox (spec §4/§21).
export async function GET() {
  try {
    const admin = await requireAdmin();

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { recipientAdminId: admin.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, title: true, body: true, actionUrl: true, readAt: true, createdAt: true },
      }),
      prisma.notification.count({ where: { recipientAdminId: admin.id, readAt: null } }),
    ]);

    return NextResponse.json({ items, unreadCount });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id } = await req.json();
    if (!id) throw new ApiError(400, "id is required");

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification || notification.recipientAdminId !== admin.id) throw new ApiError(404, "Not found");

    await prisma.notification.update({ where: { id }, data: { readAt: notification.readAt ?? new Date() } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
