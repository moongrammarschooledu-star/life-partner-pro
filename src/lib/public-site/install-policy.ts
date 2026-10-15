// When the "Install Life Partner Pro" suggestion may appear. Pure so it can be tested. It is offered on the very first page (the owner wants a
// first-time visitor to see it straight away); it stays respectful by never showing inside the installed app and by remembering a dismissal.
export const INSTALL_MIN_PAGEVIEWS = 1;
export const INSTALL_DISMISS_DAYS = 60;
/** Browsers that can install the site but never send the install event get a how-to line, shown only after this wait so it never flashes before a real Install button. */
export const INSTALL_MANUAL_DELAY_MS = 4000;

export function installPromptVisible(input: { canPrompt: boolean; ios: boolean; standalone: boolean; views: number; dismissedUntil: number; now: number }): boolean {
  if (input.standalone) return false; // already installed / running as the app
  if (!input.canPrompt && !input.ios) return false; // the browser offers no install path
  if (input.views < INSTALL_MIN_PAGEVIEWS) return false; // no page has been viewed yet (the count starts when the first page loads)
  if (input.dismissedUntil > input.now) return false; // dismissed recently
  return true;
}

// How the person can install, from the browser they are in:
//   native  - the browser sent its install event: one Install button
//   inapp   - the link opened inside Facebook, Instagram, WhatsApp, TikTok and the like. These cannot install a site at all, so the person is asked to open it in the real browser
//   ios     - iPhone / iPad: Share, then Add to Home Screen (works in Safari and, on recent iOS, in Chrome and Firefox too)
//   manual  - Android browsers that can install but sent no event (Firefox, Samsung Internet, Opera...): menu, then Install app / Add to Home screen
//   none    - desktop browsers without an install path, or nothing useful to say
export type InstallMode = "native" | "inapp" | "ios" | "manual" | "none";

export interface InstallEnvironment {
  ios: boolean;
  android: boolean;
  inApp: boolean;
}

// In-app browsers announce themselves in the user agent (Facebook: FBAN / FBAV / FB_IAB, Instagram, TikTok, Snapchat, LinkedIn, Line, Twitter, Pinterest) or, on Android,
// as a plain "; wv)" WebView.
const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Barcelona|musical_ly|BytedanceWebview|TikTok|Snapchat|LinkedInApp|Line\/|Twitter|Pinterest|WhatsApp|; wv\)/i;

export function detectInstallEnvironment(userAgent: string): InstallEnvironment {
  const ios = /iPad|iPhone|iPod/.test(userAgent);
  const android = /Android/i.test(userAgent);
  return { ios, android, inApp: IN_APP.test(userAgent) };
}

export function installMode(input: { canPrompt: boolean; env: InstallEnvironment; waitedMs: number }): InstallMode {
  if (input.canPrompt) return "native";
  if (input.env.inApp) return "inapp";
  if (input.env.ios) return "ios";
  if (input.env.android && input.waitedMs >= INSTALL_MANUAL_DELAY_MS) return "manual";
  return "none";
}
