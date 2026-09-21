// Extension point for §27/§42: real email/SMS/WhatsApp providers can be
// dropped in later by implementing this interface — nothing else in the
// app should ever import a provider SDK directly.
//
// This service carries the security-critical one-time codes (admin login OTP,
// applicant e-mail/phone verification). EMAIL goes through the real e-mail
// provider (SMTP when SMTP_USER/SMTP_PASS are set, otherwise the console
// fallback), so a code is actually delivered. A delivery failure THROWS — the
// caller must not pretend a code was sent. SMS/WhatsApp still log only until a
// real provider exists.

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

class DefaultNotificationService implements NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    if (payload.channel === "EMAIL") {
      const { emailProvider } = await import("@/lib/notifications/providers/email-provider");
      await emailProvider.send(payload.to, payload.body, payload.subject);
      return;
    }
    console.log(`[notification:${payload.channel}] to=${payload.to} :: ${payload.subject ?? ""} :: ${payload.body}`);
  }
}

export const notificationService: NotificationService = new DefaultNotificationService();
