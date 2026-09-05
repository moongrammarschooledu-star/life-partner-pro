import { randomUUID } from "crypto";
import type { NotificationProvider, ProviderSendResult } from "@/lib/notifications/providers/types";

// No real SMS provider credentials exist in this environment — console-log
// fallback, same pattern as email-provider.ts.
class ConsoleSmsProvider implements NotificationProvider {
  async send(to: string, body: string): Promise<ProviderSendResult> {
    if (process.env.SMS_PROVIDER_API_KEY) {
      // Real provider wiring goes here once SMS_PROVIDER_API_KEY is set.
    }
    console.log(`[notification:SMS] to=${to} :: ${body}`);
    return { providerMessageId: `console-sms-${randomUUID()}` };
  }
}

export const smsProvider: NotificationProvider = new ConsoleSmsProvider();
