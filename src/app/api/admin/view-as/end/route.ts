import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

export async function POST() {
  try {
    // allowViewAs:true so this call doesn't itself get blocked by the very
    // grant it's about to end — no permission is checked, this only
    // confirms a real underlying session exists.
    await requireAdmin(undefined, { allowViewAs: true });
    const store = await cookies();
    const sessionId = store.get(VIEW_AS_COOKIE)?.value;
    if (sessionId) {
      const grant = await prisma.viewAsSession.findUnique({ where: { id: sessionId } });
      if (grant && !grant.endedAt) {
        await prisma.viewAsSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
        await writeAudit({ action: "VIEW_AS_ENDED", adminId: grant.superAdminId, meta: { targetAdminId: grant.targetAdminId, viewAsSessionId: grant.id } });
      }
    }
    store.delete(VIEW_AS_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
