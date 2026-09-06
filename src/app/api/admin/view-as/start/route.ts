import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError, ApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { VIEW_AS_COOKIE, VIEW_AS_DURATION_MS } from "@/lib/view-as";

// Spec §18 — Super Admin only, reason required, time-limited, fully
// audited. Grants read-only access as the target admin (see
// src/lib/route-guard.ts's opt-in allowViewAs handling) — never access to
// the target's password or OTPs, since this never touches credentials at
// all, only the permission/row-scoping context.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("admin:manage");
    const { targetAdminId, reason } = (await req.json()) as { targetAdminId?: string; reason?: string };
    if (!targetAdminId) throw new ApiError(400, "targetAdminId is required.");
    if (!reason?.trim()) throw new ApiError(400, "A reason is required to start a View-As session.");
    if (targetAdminId === admin.id) throw new ApiError(400, "You cannot View-As yourself.");

    const target = await prisma.adminUser.findUnique({ where: { id: targetAdminId } });
    if (!target || !target.active) throw new ApiError(400, "Invalid target admin.");

    const grant = await prisma.viewAsSession.create({
      data: {
        superAdminId: admin.id,
        targetAdminId,
        reason: reason.trim(),
        expiresAt: new Date(Date.now() + VIEW_AS_DURATION_MS),
      },
    });

    await writeAudit({ action: "VIEW_AS_STARTED", adminId: admin.id, meta: { targetAdminId, reason: reason.trim(), viewAsSessionId: grant.id } });

    const store = await cookies();
    store.set(VIEW_AS_COOKIE, grant.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: VIEW_AS_DURATION_MS / 1000,
    });

    return NextResponse.json({ ok: true, expiresAt: grant.expiresAt });
  } catch (error) {
    return handleApiError(error);
  }
}
