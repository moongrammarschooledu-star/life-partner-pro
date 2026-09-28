import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { createProvider, listProviders, ADAPTERS } from "@/lib/communications/provider-service";
import { buildAdapter } from "@/lib/communications/providers/registry";
import { getProviderHealth, providerAlerts } from "@/lib/communications/provider-health";
import { currentEnvironment, testModeWarning } from "@/lib/communications/environment";
import { EXTERNAL, LOCALES, oneOf, readJson, str } from "@/lib/communications/route-utils";
import { HttpError } from "@/lib/http-error";

// Provider configuration and health. Credentials are NEVER returned: only the names of the environment variables and whether each is set.
export async function GET() {
  try {
    await requireAdmin("communications:providers:view");
    const [providers, health] = await Promise.all([listProviders(), getProviderHealth()]);
    const builtins = EXTERNAL.map((channel) => {
      const key = channel === "EMAIL" ? "EMAIL_SMTP" : channel === "SMS" ? "SMS_TWILIO" : "WHATSAPP_META";
      const adapter = buildAdapter(key, channel);
      return { channel, adapter: key, configured: adapter?.isConfigured() ?? false, effective: adapter?.isConfigured() ? key : "SANDBOX" };
    });
    return NextResponse.json({
      environment: currentEnvironment(),
      testModeWarning: testModeWarning(),
      providers,
      builtins,
      health: health.map((h) => ({ ...h, alerts: providerAlerts(h) })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// A new provider is created INACTIVE; switching it on is a separate, approval-gated change (PATCH).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("communications:providers:manage");
    const body = await readJson(req);
    const adapter = str(body.adapter, "adapter", { max: 30 });
    if (!(adapter in ADAPTERS)) throw new HttpError(400, "Unknown adapter.");
    const provider = await createProvider(admin, {
      providerKey: str(body.providerKey, "providerKey", { max: 61 }),
      name: str(body.name, "name", { max: 120 }),
      channel: oneOf(body.channel, EXTERNAL, "channel"),
      adapter,
      environment: oneOf(body.environment, ["DEVELOPMENT", "STAGING", "SANDBOX", "PRODUCTION"] as const, "environment"),
      priority: typeof body.priority === "number" ? body.priority : undefined,
      senderIdentity: str(body.senderIdentity, "senderIdentity", { max: 120, optional: true }) || null,
      supportedCountries: Array.isArray(body.supportedCountries) ? (body.supportedCountries as string[]) : undefined,
      supportedLanguages: Array.isArray(body.supportedLanguages) ? (body.supportedLanguages as string[]).map((l) => oneOf(l, LOCALES, "supportedLanguages")) : undefined,
      rateLimitPerMinute: typeof body.rateLimitPerMinute === "number" ? body.rateLimitPerMinute : undefined,
      retryMaxAttempts: typeof body.retryMaxAttempts === "number" ? body.retryMaxAttempts : undefined,
      retryBaseSeconds: typeof body.retryBaseSeconds === "number" ? body.retryBaseSeconds : undefined,
      processorId: typeof body.processorId === "string" ? body.processorId : null,
      failoverAllowed: body.failoverAllowed === true,
    });
    return NextResponse.json(provider, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
