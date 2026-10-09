import { prisma } from "@/lib/prisma";
import { resolveEffectivePermissions } from "@/lib/effective-permissions";
import { sendNotification } from "@/lib/notifications/notification-service";
import type { AdminRole } from "@/lib/permissions";

// STEP 32 — who gets told. Recipients are found by the permission they hold NOW (role or custom role), not by a stored list, so a person
// who loses a permission stops being notified without anyone editing a list. The notice itself is generic (a code, a severity and a
// category on the in-app channel); it never carries applicant details.

export async function adminsWithPermission(permission: string, max = 100): Promise<string[]> {
  const admins = await prisma.adminUser.findMany({ where: { active: true }, select: { id: true, role: true, customRoleId: true }, take: 500 });
  const out: string[] = [];
  for (const a of admins) {
    const perms = await resolveEffectivePermissions({ role: a.role as AdminRole, customRoleId: a.customRoleId ?? null });
    if ((perms as string[]).includes(permission)) out.push(a.id);
    if (out.length >= max) break;
  }
  return out;
}

export async function notifyAdmins(adminIds: string[], type: "SOC_ALERT" | "SOC_INCIDENT"): Promise<number> {
  let sent = 0;
  for (const adminId of [...new Set(adminIds)]) {
    try {
      await sendNotification({ adminId, type, data: {} });
      sent++;
    } catch {
      /* one failed notice must not stop the others (the notification service also retries on its own schedule) */
    }
  }
  return sent;
}
