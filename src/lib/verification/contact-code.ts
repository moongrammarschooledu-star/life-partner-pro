import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { resolveProviderChain } from "@/lib/communications/providers/registry";
import { normalizePhoneE164 } from "@/lib/marketing/normalize";
import { sendOtp } from "@/lib/verification/otp-service";

// Sending a one-time code to a person (STEP 38): by WhatsApp, else by SMS, else by e-mail, whichever the platform can really deliver. The mobile number is the
// primary contact; an e-mail address is optional. Rules that matter:
//   - the destination is always read from the profile's OWN contact record on the server, never from the request;
//   - a channel is used only when a REAL provider would carry it. The sandbox adapter only writes to a log, so "sending" through it would tell the person a code
//     is on its way when it is not; such a channel is skipped instead;
//   - one channel failing moves on to the next; only when none can deliver does the caller get an error (and it must say so, never pretend);
//   - with the phone sign-in switch OFF the behaviour is exactly what it was before: the code goes to the e-mail address.

export const PHONE_LOGIN_FLAG = "auth.phone_login.enabled";

export type CodeChannel = "WHATSAPP" | "SMS" | "EMAIL";

export class NoCodeChannelError extends Error {
  constructor() {
    super("No channel can deliver a code right now.");
    this.name = "NoCodeChannelError";
  }
}

// Same name as in applicant-login.ts (not imported from there: that file imports this one).
const OTP_LOGIN_FLAG = "auth.applicant_otp_login.enabled";

// Phone sign-in needs the one-time-code sign-in as well: a mobile number is an identifier other people can know, so without a code step it would be a password-less door.
export async function phoneLoginEnabled(): Promise<boolean> {
  return (await isFeatureEnabled(PHONE_LOGIN_FLAG)) && (await isFeatureEnabled(OTP_LOGIN_FLAG));
}

export const EMAIL_OPTIONAL_FLAG = "registration.email_optional";

/** Whether a new applicant may register without an e-mail address (its own switch, or phone sign-in being on). */
export async function emailOptionalAtRegistration(): Promise<boolean> {
  return (await isFeatureEnabled(EMAIL_OPTIONAL_FLAG)) || (await phoneLoginEnabled());
}

/** True only when a real (non-sandbox) provider would carry a message to this destination on this channel. */
export async function channelIsReal(channel: "SMS" | "WHATSAPP", destination: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (channel === "WHATSAPP" && !env.WHATSAPP_OTP_TEMPLATE_NAME?.trim()) return false; // a code can only go by WhatsApp through an approved template
  const chain = await resolveProviderChain({ channel, destination, env });
  const first = chain[0];
  return !!first && first.adapter.external && !first.sandboxed && first.adapter.isConfigured();
}

export interface ContactForCode {
  mobileNumber: string;
  whatsappNumber: string | null;
  email: string | null;
}

export function codeChannelOrder(phoneFirst: boolean): CodeChannel[] {
  return phoneFirst ? ["WHATSAPP", "SMS", "EMAIL"] : ["EMAIL"];
}

export function destinationForChannel(channel: CodeChannel, contact: ContactForCode): string | null {
  if (channel === "EMAIL") return contact.email?.trim() || null;
  const raw = channel === "WHATSAPP" ? contact.whatsappNumber : contact.mobileNumber;
  return normalizePhoneE164(raw);
}

export async function sendContactCode(profileId: string, purpose: "LOGIN" | "REAUTH"): Promise<{ channel: CodeChannel; destinationMasked: string }> {
  const contact = await prisma.contactInfo.findUnique({ where: { profileId }, select: { mobileNumber: true, whatsappNumber: true, email: true } });
  if (!contact) throw new NoCodeChannelError();
  const phoneFirst = await phoneLoginEnabled();
  for (const channel of codeChannelOrder(phoneFirst)) {
    const destination = destinationForChannel(channel, contact);
    if (!destination) continue;
    if (channel !== "EMAIL" && !(await channelIsReal(channel, destination))) continue;
    try {
      const sent = await sendOtp(profileId, channel === "EMAIL" ? "EMAIL" : "PHONE", destination, purpose === "LOGIN" ? "LOGIN" : "VERIFY", channel === "EMAIL" ? {} : { deliverVia: channel });
      return { channel, destinationMasked: sent.destinationMasked };
    } catch {
      // this channel could not deliver (provider down, number refused): try the next one
    }
  }
  throw new NoCodeChannelError();
}

const CHANNEL_WORD: Record<CodeChannel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "e-mail" };
export const channelWord = (c: CodeChannel) => CHANNEL_WORD[c];
