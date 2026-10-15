import { normalizePhoneE164 } from "@/lib/marketing/normalize";

// Click-to-chat links (wa.me): the person taps the link, WhatsApp opens with the message already written, and THEY press send. Nothing is sent by the server and no
// WhatsApp Business API, token or template is involved, so it works with an ordinary WhatsApp / WhatsApp Business number. It is not an automated message: it
// cannot send sign-in codes (that needs the Cloud API).

const MAX_MESSAGE_CHARS = 1000;

/** The number in the form wa.me wants: international digits, no "+", no leading zero. Null when it is not a usable number. Pakistani numbers may be written 03xx... */
export function whatsappDigits(raw: string | null | undefined): string | null {
  if (!raw || /[A-Za-z]/.test(raw)) return null; // a phone number never contains letters; refuse a pasted link or text instead of picking its digits
  const e164 = normalizePhoneE164(raw, "92");
  return e164 ? e164.slice(1) : null;
}

/** https://wa.me/<digits>?text=<message>, or null when the number is not usable. */
export function whatsappChatUrl(number: string | null | undefined, message?: string): string | null {
  const digits = whatsappDigits(number);
  if (!digits) return null;
  const text = message?.trim().slice(0, MAX_MESSAGE_CHARS);
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
