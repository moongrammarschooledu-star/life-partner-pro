# Public Route Map (STEP 35)

Source of truth in code: `src/lib/public-site/routes.ts` (titles, descriptions, indexing, sitemap) and `PRIVATE_PATH_PREFIXES` / `PRIVATE_NOINDEX_PATHS` (areas kept out of search). A test (`public-site.test.ts`) fails if a route listed here or in the registry has no page, or if this file and the registry disagree.

Legend — **Access**: Public (no sign-in) · Applicant (signed-in applicant) · Family (signed-in family member) · Admin (staff). **Index**: Indexed (in sitemap, `index,follow`) · Noindex (page says `noindex`, still crawlable so the tag can be read) · Blocked (`robots.txt` disallow **and** `X-Robots-Tag: noindex`).

## Public marketing and content pages

| Route | Access | Index | Notes |
|---|---|---|---|
| `/` | Public | Indexed | Hero, 7-step summary, why, trust & safety, family, membership (live packages), FAQ, final CTA. Organization + WebSite + FAQPage JSON-LD |
| `/about` | Public | Indexed | Mission, privacy-first, family-friendly, human review. No invented founders, awards or numbers |
| `/how-it-works` | Public | Indexed | Twelve steps; states the platform does not guarantee an outcome |
| `/why-life-partner-pro` | Public | Indexed | |
| `/for-applicants` | Public | Indexed | |
| `/for-families` | Public | Indexed | Optional, invitation-based family access |
| `/verification` | Public | Indexed | What is checked and what verification cannot promise |
| `/safety` | Public | Indexed | No internal detection rules or risk scores |
| `/pricing` | Public | Indexed | Live package configuration (server-rendered, refreshed every 5 minutes); no hard-coded prices |
| `/faq` | Public | Indexed | Eight categories; FAQPage JSON-LD generated from the same list |
| `/contact` | Public | Indexed | Contact form → support inbox (category + consent recorded) |
| `/support` | Public | Indexed | Help links + the same form |
| `/blog`, `/blog/[slug]` | Public | Indexed (filtered/paged views and `noindex` items excluded) | Published or scheduled-and-due items only |
| `/guides`, `/guides/[slug]` | Public | Indexed (same rules) | |
| `/register` | Public | Indexed | Registration wizard (see `APPLICANT_ONBOARDING.md`) |
| `/privacy-policy` | Public | Indexed | `/privacy` redirects here (301). Legal-review notice until `LEGAL_PAGES_REVIEWED=true` |
| `/delete-account` | Public | Indexed | How to ask for account deletion (website and app); linked from the app and the store listings (STEP 37) |
| `/terms` | Public | Indexed | Same notice; governing law only from `LEGAL_GOVERNING_LAW` |
| `/lp/[slug]` | Public | Per page (noindex by default) | STEP 29 landing pages (flag-gated) |

## Sign-in and utility pages (public, not indexed)

| Route | Access | Index | Notes |
|---|---|---|---|
| `/login` | Public | Noindex | Points to applicant and family sign-in; collects no credential itself |
| `/forgot-password` | Public | Noindex | Explains e-mail-code sign-in; family accounts have no self-service reset yet |
| `/report-concern` | Applicant | Noindex | |
| `/update-request` | Applicant | Noindex | |
| `/register/confirmation` | Public (carries `?code=`) | Noindex | Contains the Profile ID in the address |
| `/offline` | Public | Noindex | Shown by the service worker when the network is down |
| `/status` | Public | Noindex | Platform status and service notices (STEP 36); stays reachable during maintenance |
| `/my-status` | Public sign-in form | Blocked | Applicant sign-in (Profile ID + e-mail code) |

## Private areas (never indexed)

| Route | Access | Index |
|---|---|---|
| `/dashboard` and below | Applicant | Blocked |
| `/my-billing`, `/my-cases`, `/my-notifications`, `/my-privacy`, `/my-proposals`, `/my-verification` | Applicant | Blocked |
| `/account-settings` | Applicant | Blocked |
| `/family/*` (dashboard, applicant, proposals, meetings, documents, consent, security, communications) | Family | Blocked |
| `/family/register` | Family (invitation) | Blocked |
| `/admin/*` (including `/admin/content`, `/admin/public-site`) | Admin | Blocked |
| `/api/*` | Mixed | Blocked |
| `/maintenance` | Public | Blocked |

## Technical files

| Route | Purpose |
|---|---|
| `/sitemap.xml` | Indexable registry pages + live blog/guides + published landing pages. Empty if no canonical base URL is configured |
| `/robots.txt` | Allows public content; disallows the private prefixes; points at the sitemap |
| `/manifest.webmanifest` | PWA manifest (installable) |
| `/sw.js` | Service worker: caches only the offline page, brand icons and `/_next/static/` files; never an HTML page or API response |
| `/api/public-events` | Anonymous visitor beacon (off by default; honours Do Not Track / Global Privacy Control) |
