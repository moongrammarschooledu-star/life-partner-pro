import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { writeAudit } from "@/lib/audit";

const FLAG_KEYS = [
  "paymentsEnabled",
  "checkoutEnabled",
  "subscriptionsEnabled",
  "refundsEnabled",
  "manualPaymentEnabled",
  "betaEnabled",
  "publicCheckoutEnabled",
  "providerWebhooksEnabled",
] as const;

// Spec §73 — every flag here is enforced server-side (see assertPaymentsAvailable
// in src/lib/finance/rollout.ts); this route only ever changes the stored
// values a client can subsequently read for presentation, never the
// enforcement itself.
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin("finance:rollout:manage");
    const body = (await req.json()) as Record<string, unknown>;

    const updates: Record<string, boolean> = {};
    for (const key of FLAG_KEYS) {
      if (key in body && typeof body[key] === "boolean") updates[key] = body[key] as boolean;
    }

    const settings = await prisma.appSettings.upsert({ where: { id: 1 }, update: updates, create: { id: 1, ...updates } });
    await writeAudit({ action: "PAYMENT_FEATURE_FLAG_CHANGED", adminId: admin.id, meta: { changed: updates } });

    return NextResponse.json(settings);
  } catch (error) {
    return handleApiError(error);
  }
}
