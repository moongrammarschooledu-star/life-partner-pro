import { randomUUID } from "crypto";
import nodemailer, { type Transporter } from "nodemailer";
import type { NotificationProvider, ProviderSendResult } from "@/lib/notifications/providers/types";

// Real delivery goes through SMTP (Gmail by default). It is "configured" only
// when SMTP_USER and SMTP_PASS are both set — see isEmailConfigured(). Without
// them the app falls back to the console-log behaviour it has always had, so
// local development never needs credentials. Nothing else in the app should
// import a mail SDK directly; swap the export below to change provider.

type Env = Record<string, string | undefined>;

export function isEmailConfigured(env: Env = process.env): boolean {
  return Boolean(env.SMTP_USER?.trim() && env.SMTP_PASS?.trim());
}

class ConsoleEmailProvider implements NotificationProvider {
  async send(to: string, body: string, subject?: string): Promise<ProviderSendResult> {
    console.log(`[notification:EMAIL] to=${to} :: ${subject ?? ""} :: ${body}`);
    return { providerMessageId: `console-email-${randomUUID()}` };
  }
}

class SmtpEmailProvider implements NotificationProvider {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(process.env.SMTP_PORT) || 465;
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
        port,
        secure: port === 465,
        auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS!.trim() },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    }
    return this.transporter;
  }

  // Throws on a genuine transport failure — dispatch.ts records that on the
  // CommunicationLog row, so a failed delivery is never reported as sent.
  async send(to: string, body: string, subject?: string): Promise<ProviderSendResult> {
    const from = process.env.EMAIL_FROM?.trim() || `Life Partner Pro <${process.env.SMTP_USER!.trim()}>`;
    const info = await this.getTransporter().sendMail({ from, to, subject: subject ?? "Life Partner Pro", text: body });
    return { providerMessageId: info.messageId };
  }
}

const fallback = new ConsoleEmailProvider();
const smtp = new SmtpEmailProvider();

// Chosen per call so configuring the variables takes effect without code changes.
export const emailProvider: NotificationProvider = {
  send: (to, body, subject) => (isEmailConfigured() ? smtp : fallback).send(to, body, subject),
};
