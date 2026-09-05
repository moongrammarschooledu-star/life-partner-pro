import { randomUUID } from "crypto";
import type { NotificationProvider, ProviderSendResult } from "@/lib/notifications/providers/types";

// Modular WhatsApp Business API integration point (spec §7) — no specific
// provider is assumed. WHATSAPP_ENABLED is the module-level env-var switch
// the spec explicitly asks for, separate from AppSettings.whatsappNotificationsEnabled
// (the admin-facing runtime toggle checked in dispatch.ts). Neither is set in
// this environment, so this always falls back to the console-log behavior.
class ConsoleWhatsAppProvider implements NotificationProvider {
  async send(to: string, body: string): Promise<ProviderSendResult> {
    if (process.env.WHATSAPP_ENABLED === "true" && process.env.WHATSAPP_API_KEY) {
      // Real WhatsApp Business API wiring (template messages, phone_number_id, etc.)
      // goes here once WHATSAPP_ENABLED/WHATSAPP_API_KEY are set.
    }
    console.log(`[notification:WHATSAPP] to=${to} :: ${body}`);
    return { providerMessageId: `console-whatsapp-${randomUUID()}` };
  }
}

export const whatsappProvider: NotificationProvider = new ConsoleWhatsAppProvider();
