// Extension point for §27/§42: real email/SMS/WhatsApp providers are plugged in through the communication provider registry
// (src/lib/communications/providers) — nothing else in the app should ever import a provider SDK directly.
//
// This service carries the security-critical one-time codes (admin login OTP, applicant e-mail/phone verification). Delivery goes
// through the provider registry with its environment guard (outside production real messages only reach allow-listed test
// recipients; everything else is handed to the sandbox, which logs to the console for developers). A delivery failure THROWS — the
// caller must not pretend a code was sent. Raw codes are redacted from production logs unless COMMUNICATION_DEBUG_OTP=true.

export type NotificationChannel = "EMAIL" | "SMS" | "WHATSAPP";

export interface NotificationPayload {
  channel: NotificationChannel;
  to: string;
  subject?: string;
  body: string;
  profileId?: string; // optional: records a body-less delivery-status row for the applicant
}

export interface NotificationService {
  send(payload: NotificationPayload): Promise<void>;
}

class DefaultNotificationService implements NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    const { sendOneTimeCode } = await import("@/lib/communications/otp-sender");
    await sendOneTimeCode(payload);
  }
}

export const notificationService: NotificationService = new DefaultNotificationService();
