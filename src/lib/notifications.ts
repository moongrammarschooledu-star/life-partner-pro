// Extension point for §27/§42: real email/SMS/WhatsApp providers can be
// dropped in later by implementing this interface — nothing else in the
// app should ever import a provider SDK directly.

export type NotificationChannel = "EMAIL" | "SMS" | "WHATSAPP";

export interface NotificationPayload {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
}

export interface NotificationService {
  send(payload: NotificationPayload): Promise<void>;
}

// Default implementation: logs only. No external API credentials are
// referenced anywhere in this codebase (per spec §27/§44 — "do not
// hard-code external API credentials").
class ConsoleNotificationService implements NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    console.log(`[notification:${payload.channel}] to=${payload.to} :: ${payload.subject ?? ""} :: ${payload.body}`);
  }
}

export const notificationService: NotificationService = new ConsoleNotificationService();
