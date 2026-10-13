// When the "Install Life Partner Pro" suggestion may appear. Pure so it can be tested: respectful by design (spec §34).
export const INSTALL_MIN_PAGEVIEWS = 2;
export const INSTALL_DISMISS_DAYS = 60;

export function installPromptVisible(input: { canPrompt: boolean; ios: boolean; standalone: boolean; views: number; dismissedUntil: number; now: number }): boolean {
  if (input.standalone) return false; // already installed / running as the app
  if (!input.canPrompt && !input.ios) return false; // the browser offers no install path
  if (input.views < INSTALL_MIN_PAGEVIEWS) return false; // not on the very first page
  if (input.dismissedUntil > input.now) return false; // dismissed recently
  return true;
}
