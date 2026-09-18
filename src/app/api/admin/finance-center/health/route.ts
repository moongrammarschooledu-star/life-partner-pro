import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { getPaymentSystemHealth, getWebhookHealth, getProviderHealth, getSandboxReadinessChecklist } from "@/lib/finance/rollout";

export async function GET() {
  try {
    await requireAdmin("finance:rollout:view");
    const [systemHealth, webhookHealth, providerHealth, sandboxReadinessChecklist] = await Promise.all([
      getPaymentSystemHealth(),
      getWebhookHealth(),
      getProviderHealth(),
      getSandboxReadinessChecklist(),
    ]);
    return NextResponse.json({ systemHealth, webhookHealth, providerHealth, sandboxReadinessChecklist });
  } catch (error) {
    return handleApiError(error);
  }
}
