import { randomUUID } from "crypto";
import type { NotificationProvider, ProviderSendResult } from "@/lib/notifications/providers/types";

// No real email provider credentials exist in this environment (same gap as
// every prior step) — falls back to the console-log behavior the app has
// always used. Dropping in a real provider later means implementing this
// same interface and swapping the export below; nothing else in the app
// should ever import a provider SDK directly.
class ConsoleEmailProvider implements NotificationProvider {
  async send(to: string, body: string, subject?: string): Promise<ProviderSendResult> {
    if (process.env.EMAIL_PROVIDER_API_KEY) {
      // Real provider wiring goes here once EMAIL_PROVIDER_API_KEY is set.
    }
    console.log(`[notification:EMAIL] to=${to} :: ${subject ?? ""} :: ${body}`);
    return { providerMessageId: `console-email-${randomUUID()}` };
  }
}

export const emailProvider: NotificationProvider = new ConsoleEmailProvider();
