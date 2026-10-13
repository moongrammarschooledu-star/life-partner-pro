// Single source of truth for every public page: its search title and description, whether search engines may index it, and whether it
// belongs in the sitemap. Page metadata, the sitemap, the route map document and the tests all read this list, so a page cannot be
// indexable on one side and missing on another.
//
// Wording rules (STEP 35): no guarantee of a match or a marriage, no absolute "every profile is genuine" claim, no invented numbers, no keyword stuffing.

export type PublicRouteKind = "marketing" | "content" | "legal" | "utility" | "auth";

export interface PublicRoute {
  path: string;
  title: string;
  description: string;
  kind: PublicRouteKind;
  /** false = noindex (utility / sign-in pages): still crawlable so the tag can be read, never listed. */
  indexable: boolean;
  changeFrequency?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: "/",
    title: "Life Partner Pro — Finding the Right Life Partner, With Trust",
    description: "A private, structured and family-friendly matrimonial platform where applicants and families explore compatible proposals through a guided, consent-based process.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "weekly",
    priority: 1,
  },
  {
    path: "/about",
    title: "About Life Partner Pro — Private, Family-Friendly Matchmaking",
    description: "Why Life Partner Pro exists: a privacy-first, family-friendly approach to matrimonial matchmaking with structured profiles and human review.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/how-it-works",
    title: "How Life Partner Pro Matrimonial Matching Works",
    description: "The full process from creating a profile to a family meeting: verification, matching, proposals, mutual interest and consent-based contact sharing.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/why-life-partner-pro",
    title: "Why Choose Life Partner Pro | Private Matrimonial Platform",
    description: "Privacy, structured profiles, verification, family participation, admin-assisted matchmaking and consent-based contact sharing, explained plainly.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/for-applicants",
    title: "For Applicants | Life Partner Pro",
    description: "What to expect as an applicant: creating a profile, what is asked and why, who can see it, and how proposals work.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.7,
  },
  {
    path: "/for-families",
    title: "Family-Friendly Matrimonial Matching | Life Partner Pro",
    description: "Optional, invitation-based family access with delegated permissions: review proposals, comment and coordinate meetings, always under the applicant's control.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/verification",
    title: "Profile Verification & Safety | Life Partner Pro",
    description: "How contact verification, profile review, identity and document checks work, what a verification badge means, and what verification cannot promise.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/safety",
    title: "Safety & Privacy Guidance | Life Partner Pro",
    description: "Privacy controls, reporting, contact protection, account security and safe-meeting practices for applicants and families.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/pricing",
    title: "Membership & Packages | Life Partner Pro",
    description: "Available membership packages, their features, billing period and price. Packages provide platform features, not a guaranteed outcome.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    path: "/faq",
    title: "Frequently Asked Questions | Life Partner Pro",
    description: "Answers about privacy, verification, matching, proposals, family participation, safety and membership.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    path: "/contact",
    title: "Contact Life Partner Pro",
    description: "Send a general, technical or privacy-related enquiry to the Life Partner Pro team.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/support",
    title: "Help & Support | Life Partner Pro",
    description: "Find answers, contact support, report a concern or make a privacy request.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "yearly",
    priority: 0.5,
  },
  {
    path: "/blog",
    title: "Blog | Life Partner Pro",
    description: "Informational articles on matrimonial matchmaking, family participation and safe online practices.",
    kind: "content",
    indexable: true,
    changeFrequency: "weekly",
    priority: 0.6,
  },
  {
    path: "/guides",
    title: "Guides | Life Partner Pro",
    description: "Step-by-step guides: creating a profile, how verification works and preparing for a family meeting.",
    kind: "content",
    indexable: true,
    changeFrequency: "weekly",
    priority: 0.6,
  },
  {
    path: "/register",
    title: "Create Your Matrimonial Profile | Life Partner Pro",
    description: "Start a private matrimonial profile. Your personal information is not publicly displayed.",
    kind: "marketing",
    indexable: true,
    changeFrequency: "monthly",
    priority: 0.9,
  },
  {
    path: "/privacy-policy",
    title: "Privacy Policy | Life Partner Pro",
    description: "What information Life Partner Pro collects, why, who can see it, how long it is kept and how to control or delete it.",
    kind: "legal",
    indexable: true,
    changeFrequency: "yearly",
    priority: 0.4,
  },
  {
    path: "/terms",
    title: "Terms & Conditions | Life Partner Pro",
    description: "The terms for using Life Partner Pro: account use, acceptable use, verification limits, membership and payments.",
    kind: "legal",
    indexable: true,
    changeFrequency: "yearly",
    priority: 0.4,
  },
  // Utility and sign-in pages: reachable and crawlable (so the noindex tag is readable) but never listed.
  { path: "/login", title: "Sign In | Life Partner Pro", description: "Sign in as an applicant or a family member.", kind: "auth", indexable: false },
  { path: "/forgot-password", title: "Trouble Signing In | Life Partner Pro", description: "How to regain access to your Life Partner Pro account.", kind: "auth", indexable: false },
  { path: "/report-concern", title: "Report a Concern | Life Partner Pro", description: "Report suspicious activity or a safety concern.", kind: "utility", indexable: false },
  { path: "/update-request", title: "Request a Profile Update | Life Partner Pro", description: "Ask for a change to your profile.", kind: "utility", indexable: false },
  { path: "/register/confirmation", title: "Registration Received | Life Partner Pro", description: "Your registration was received.", kind: "utility", indexable: false },
  { path: "/offline", title: "You Are Offline | Life Partner Pro", description: "You are offline.", kind: "utility", indexable: false },
];

export function findPublicRoute(path: string): PublicRoute | undefined {
  return PUBLIC_ROUTES.find((r) => r.path === path);
}

/** Path prefixes of signed-in or private areas. Crawlers are told to stay out (robots.txt); each area also enforces its own access. */
export const PRIVATE_PATH_PREFIXES = ["/admin", "/api/", "/dashboard", "/family", "/my-", "/account-settings", "/maintenance", "/private", "/internal"] as const;

/** Private and signed-in areas that also answer with "X-Robots-Tag: noindex" (see next.config.ts). Every my-* page folder must be listed here. */
export const PRIVATE_NOINDEX_PATHS = ["/admin", "/dashboard", "/account-settings", "/family", "/maintenance", "/my-billing", "/my-cases", "/my-notifications", "/my-privacy", "/my-proposals", "/my-status", "/my-verification"] as const;

/** Paths where the navigation shows the signed-in applicant links instead of the marketing links. */
export function isApplicantAppPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return ["/dashboard", "/my-", "/account-settings", "/update-request", "/report-concern", "/register/confirmation"].some((p) => pathname === p || pathname.startsWith(p));
}
