// What a push notification is allowed to show (STEP 37 §12–§13). Pure.
//
// Nothing about a person, a proposal, a phone number or a family member ever goes into the title or body. The in-app notification text is already written to
// be privacy-safe (STEP 9), but the lock screen is a more public place than the app, so the DEFAULT is PRIVATE: one generic line. The person can choose
// FULL (the same generic app text), MINIMAL (no hint at all) or OFF. The data part carries only an id and an app path; the app asks the server what the id means.

export const DISPLAY_MODES = ["FULL", "PRIVATE", "MINIMAL", "OFF"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];
export const DEFAULT_DISPLAY_MODE: DisplayMode = "PRIVATE";

export function isDisplayMode(v: unknown): v is DisplayMode {
  return typeof v === "string" && (DISPLAY_MODES as readonly string[]).includes(v);
}

/** Device setting wins over the account setting; anything unknown falls back to the safest visible mode. */
export function effectiveMode(device: string | null | undefined, account: string | null | undefined): DisplayMode {
  if (isDisplayMode(device)) return device;
  if (isDisplayMode(account)) return account;
  return DEFAULT_DISPLAY_MODE;
}

export interface PushContent {
  title: string;
  body: string;
  /** Only an identifier of the in-app notification and an in-app path. No names, numbers, ids of people or proposals. */
  data: { n: string; p: string };
}

const SAFE_PATH = /^\/[A-Za-z0-9/_-]{0,80}$/;

export function safePushPath(path: string | null | undefined): string {
  return typeof path === "string" && SAFE_PATH.test(path) && !path.includes("//") ? path : "/dashboard";
}

export function buildPushContent(mode: DisplayMode, inApp: { title: string; body: string }, notificationId: string, path: string | null | undefined): PushContent | null {
  if (mode === "OFF") return null;
  const data = { n: notificationId, p: safePushPath(path) };
  if (mode === "FULL") return { title: inApp.title.slice(0, 80), body: inApp.body.slice(0, 160), data };
  if (mode === "PRIVATE") return { title: "Life Partner Pro", body: "You have a new update in Life Partner Pro.", data };
  return { title: "Life Partner Pro", body: "Open the app.", data };
}

/** Marketing-style notifications are never pushed. */
export function isPushableCategory(category: string | null | undefined, priority: string | null | undefined): boolean {
  if (!category) return false;
  if (category === "MARKETING") return false;
  return priority !== "LOW" || category === "SECURITY";
}