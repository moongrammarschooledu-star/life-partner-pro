// When the "Install Life Partner Pro" suggestion may appear. Pure so it can be tested. It is offered on the very first page (the owner wants a
// first-time visitor to see it straight away); it stays respectful by never showing inside the installed app and by remembering a dismissal.
export const INSTALL_MIN_PAGEVIEWS = 1;
export const INSTALL_DISMISS_DAYS = 60;

export function installPromptVisible(input: { canPrompt: boolean; ios: boolean; standalone: boolean; views: number; dismissedUntil: number; now: number }): boolean {
  if (input.standalone) return false; // already installed / running as the app
  if (!input.canPrompt && !input.ios) return false; // the browser offers no install path
  if (input.views < INSTALL_MIN_PAGEVIEWS) return false; // no page has been viewed yet (the count starts when the first page loads)
  if (input.dismissedUntil > input.now) return false; // dismissed recently
  return true;
}
