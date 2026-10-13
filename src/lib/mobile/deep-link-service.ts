import { buildProposalDetailForProfile } from "@/lib/visibility/proposal-visibility";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { mobileIdentity } from "@/lib/mobile/config";
import { parseDeepLink } from "@/lib/mobile/deep-link";
import { mobileEvent } from "@/lib/mobile/security-events";
import type { MobileActor } from "@/lib/mobile/auth";

// Resolving a deep link (STEP 37 §14). The app asks the server "may I open this?" before it navigates. The answer is only ever a path the application already
// serves, and every reason a link cannot be opened looks the same to the caller (NOT_FOUND), so a link cannot be used to learn whether a record exists.

export type ResolveResult =
  | { allowed: true; path: string }
  | { allowed: false; reason: "SIGN_IN_REQUIRED"; path: string } // the app signs the person in, then asks again
  | { allowed: false; reason: "NOT_FOUND" | "DISABLED" };

export async function resolveDeepLink(actor: MobileActor | null, input: unknown): Promise<ResolveResult> {
  if (!(await isFeatureEnabled("mobile.deep_links.enabled")) || !(await isFeatureEnabled("mobile.app.enabled"))) return { allowed: false, reason: "DISABLED" };

  const parsed = parseDeepLink(input, mobileIdentity().appHosts);
  if (!parsed.ok) {
    await mobileEvent("MOBILE_DEEP_LINK_OPENED", actor, { result: parsed.reason }, "REFUSED");
    return { allowed: false, reason: "NOT_FOUND" };
  }
  if (!actor) return { allowed: false, reason: "SIGN_IN_REQUIRED", path: parsed.pattern.audience === "FAMILY" ? "/family/dashboard" : "/login" };

  const wantsFamily = parsed.pattern.audience === "FAMILY";
  if (wantsFamily !== (actor.kind === "FAMILY")) {
    await mobileEvent("MOBILE_DEEP_LINK_OPENED", actor, { result: "WRONG_AUDIENCE" }, "REFUSED");
    return { allowed: false, reason: "NOT_FOUND" };
  }

  if (parsed.pattern.record === "PROPOSAL" && parsed.id && actor.kind === "PROFILE") {
    // The same check the website uses for this page: null for "no such proposal" and "not yours" alike.
    const detail = await buildProposalDetailForProfile(actor.profileId, parsed.id);
    if (!detail) {
      await mobileEvent("MOBILE_DEEP_LINK_OPENED", actor, { result: "RECORD_NOT_ACCESSIBLE" }, "REFUSED");
      return { allowed: false, reason: "NOT_FOUND" };
    }
  }

  await mobileEvent("MOBILE_DEEP_LINK_OPENED", actor, { result: "OPENED", target: parsed.pattern.pattern }, "ALLOWED");
  return { allowed: true, path: parsed.path };
}