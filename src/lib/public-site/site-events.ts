import { z } from "zod";
import { findPublicRoute, isApplicantAppPath } from "@/lib/public-site/routes";

// What the public-site beacon may record (STEP 35 §42). Anonymous by design: a public page path (never a query string), one of three event
// kinds, an optional call-to-action id, and nothing about the person. The visitor key is a salted hash made on the server.

export const SITE_EVENT_TYPES = ["PAGE_VIEW", "CTA_CLICK", "REGISTRATION_STARTED"] as const;
export type SiteEventType = (typeof SITE_EVENT_TYPES)[number];

export const siteEventSchema = z.object({
  type: z.enum(SITE_EVENT_TYPES),
  path: z.string().max(120),
  cta: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
});

const CONTENT_PATH = /^\/(blog|guides)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The path to record, or null when the page is not a public marketing page (account pages and unknown paths are never recorded). */
export function recordablePath(raw: string): string | null {
  const path = raw.split("?")[0].split("#")[0];
  if (path.length > 80 || isApplicantAppPath(path)) return null;
  if (CONTENT_PATH.test(path)) return path;
  const route = findPublicRoute(path);
  return route && route.indexable ? path : null;
}

/** Do Not Track and Global Privacy Control are honoured: such a visitor is not counted at all. */
export function optedOutOfTracking(headers: { get(name: string): string | null }): boolean {
  return headers.get("dnt") === "1" || headers.get("sec-gpc") === "1";
}
