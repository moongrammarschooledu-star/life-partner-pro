import { publicOrigin } from "@/lib/config/public-url";

export const SITE_NAME = "Life Partner Pro";
export const SITE_TAGLINE = "Finding the Right Life Partner, With Trust.";
export const SITE_DESCRIPTION =
  "A private, structured and family-friendly matrimonial platform designed to help applicants and families explore compatible proposals through a guided, consent-based process.";

// Absolute base for canonical tags, Open Graph and structured data. It comes from the one place that decides the public address
// (`publicOrigin()`: APP_URL, then the older settings, then the Vercel production URL). A reserved ".invalid" address is used only if a
// production build has no address at all; nothing is indexed from it because the sitemap is empty in that case.
export function siteUrl(): string {
  try {
    return publicOrigin();
  } catch {
    return "https://placeholder.invalid";
  }
}
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}
