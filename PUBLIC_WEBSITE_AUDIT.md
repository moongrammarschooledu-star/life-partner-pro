# Public Website Audit (STEP 35, written before any change)

Scope: the public, unauthenticated surface of Life Partner Pro as it stands on `main` at `4432492`. This audit is a **static read of the code**. Performance and accessibility have **not been measured yet** (no Lighthouse / axe run); those sections list code-level observations only and say so. Measured results come in the final test pass and are recorded separately.

## 1. What exists

| Area | Route / file | State |
|---|---|---|
| Home | `/` (`(public)/page.tsx`) | Static server page: hero, 5-step "How it works", 6 "Why us" cards, final CTA. No FAQ, trust, family or pricing sections. |
| How it works | `/how-it-works` | 7 steps, static. |
| Pricing | `/pricing` | Client page reading `/api/my-billing/packages` (backend-driven, no hard-coded prices). Good: states "no guarantee". No tax / billing-period / usage-limit display. |
| Register | `/register`, `/register/confirmation` | 8-step wizard (`RegistrationWizard`): basic, contact, education/profession, family, lifestyle, preference, photo, review. Draft kept in `localStorage`. Honeypot + rate limit (5/min) on `POST /api/register`. Creates the profile directly (no account / contact-verification step first). |
| Applicant sign-in | `/my-status` (Profile ID + e-mail code) | Exists (STEP 33). No `/login` or `/forgot-password` route. |
| Support | `/support` | Client form → `POST /api/support` → `SupportMessage` table (admin `/api/admin/support`). Rate limit 5/min. No category, no consent line, no honeypot/CAPTCHA, not connected to CRM. |
| Legal | `/privacy-policy`, `/terms` | 4 short paragraphs each. |
| Other public | `/report-concern`, `/update-request`, `/maintenance`, `/lp/[slug]` (STEP 29 landing pages), `/family/register` | Exist. |
| Landing pages | `/lp/[slug]` + admin builder, versions, forms, UTM/touch tokens, consent, CRM dedup, experiments (STEP 29) | **Already built**, behind marketing flags. Per-page `noindex` default, sitemap only lists published, opted-in pages. |
| SEO files | `app/sitemap.ts`, `app/robots.ts`, `app/icon.png` | Sitemap lists **only** landing pages (empty if flags off or no base URL). Robots disallows `/admin /api/ /dashboard /family /my- /maintenance`. |
| Analytics | `POST /api/marketing/events` (signed touch token, same-origin, 60/min, stores salted hash only) | Landing-page events only (`LANDING_PAGE_VIEW`, `CTA_CLICK`, `FORM_STARTED`). Nothing for the main site. |
| Profile completeness | `lib/verification/completeness.ts` (`computeProfileCompleteness`) | Exists and must be reused. Not shown in the registration wizard. |
| Security headers | `next.config.ts` | CSP is **report-only** (owner decision pending), nosniff, frame deny, referrer policy, HSTS in production. |
| Fonts | `next/font` Playfair Display + Inter | Self-hosted by Next, fine. |
| Assets | `public/logo-full.png` (803 KB), `logo-icon.png` (342 KB), unused `file/globe/next/vercel/window.svg` | Heavy source images; unused default SVGs. |

## 2. Missing pages (named in the STEP 35 spec)

`/about`, `/why-life-partner-pro`, `/for-applicants`, `/for-families`, `/verification`, `/safety`, `/faq`, `/contact`, `/blog`, `/guides`, `/login`, `/forgot-password`, plus a web app manifest, install prompt, service worker, structured data, and a content system for blog/guides.

## 3. Duplicates / overlaps (reuse, do not rebuild)

- `/support` and the new `/contact` overlap. Plan: keep **one** form and route (`/support` stays; `/contact` becomes the contact page that uses the same endpoint and shows the support categories), no second backend.
- Landing-page builder, UTM capture, lead forms, consent and CRM dedup already exist (STEP 29). Spec items 37–41 are **verified and extended**, not rebuilt.
- Registration + sign-in already exist. The spec's "Create Account → Verify Contact → Start Profile" does not match the real flow ("fill the wizard → get a Profile ID → sign in with an e-mail code"). Plan: do **not** rewrite authentication; describe the real flow truthfully and improve the wizard (completion %, privacy notes, optional markers).
- `/privacy-policy` vs the spec's `/privacy`: keep `/privacy-policy`, add `/privacy` as a redirect.

## 4. SEO issues

1. Only the root layout has metadata; **no page except `/register` has its own title/description**. Every page shares one title.
2. No canonical URLs, Open Graph, Twitter cards or structured data on the main site.
3. Sitemap omits every static public page (home, how-it-works, pricing, privacy, terms, support).
4. Robots leaves these crawlable and not noindexed: `/account-settings`, `/update-request`, `/report-concern`, `/register/confirmation`, `/family/register`. (`/my-*` and `/dashboard` are covered.)
5. `pricing` and `support` are client components, so they cannot export metadata as written.
6. No `manifest`; icon only.

## 5. UX issues

1. **No mobile navigation.** The navbar uses `hidden … sm:flex`; on a phone the links disappear entirely, leaving only the theme toggle, notification bell and "Register Your Profile".
2. The public navbar mixes marketing links with signed-in links (Dashboard, My Verification, My Proposals, My Notifications, Account & Privacy, Packages) and an **Admin** link, shown to every anonymous visitor. The footer also links "Admin Login".
3. No FAQ, trust/safety, family or verification information anywhere; home page does not mention families at all.
4. Wizard progress exists (`StepIndicator`) but no completion percentage, no "optional" labels, and the draft is stored in the browser's `localStorage` (device-only; includes personal data — noted for the privacy review).

## 6. Conversion issues

1. One primary CTA only; no secondary "Login", no pricing link on home.
2. Public pages emit no funnel events, so the funnel (visit → register → submit) cannot be measured outside landing pages.
3. Contact form has no categories (technical, privacy, general), so requests cannot be routed.

## 7. Claims that conflict with the STEP 35 trust rules (to correct)

- Home: "Admin Verified Profiles — **Every** profile is reviewed and verified by our team before matching begins." and How it works: "reviews and verifies **every** submission". These are absolute. Replace with the actual, configurable review/verification process (STEP 15/33 verification states).
- Home: "Smart Matching … highlights the **most suitable** proposals." Soften; no outcome implication.
- Privacy: "We do not sell or share your data with third parties." The platform uses processors (hosting, database, e-mail/SMS/WhatsApp providers). Needs wording reviewed by the owner/legal; I will not invent legal text and will mark it legal-review-sensitive.
- Privacy: photos "only ever viewed by authorized administrators" — family/guardian access (STEP 22) and proposal sharing exist. Needs accurate wording.

## 8. Mobile issues

- Missing mobile menu (above).
- No manifest, no install experience, no offline page, no service worker.
- Tap targets and layout not measured; Tailwind responsive classes are used throughout, so layout is likely acceptable once the menu exists. **Not measured.**

## 9. Accessibility issues (code-level, not measured)

- No skip-to-content link.
- `<main>` and `<nav>` landmarks exist but the nav has no `aria-label`.
- Theme toggle has an `aria-label`; the notification bell and mobile controls need checking.
- Forms use `Field` with labels; error announcement (`aria-live`) not verified.
- Final axe/keyboard pass is part of the STEP 35 test run.

## 10. Performance issues (code-level, not measured)

- `logo-full.png` 803 KB and `logo-icon.png` 342 KB source files; `next/image` resizes the icon but the originals are far larger than needed. Convert to optimised WebP/AVIF or smaller PNG.
- Pricing fetches on the client after load (empty first paint); acceptable but should render server-side for SEO.
- Home is a static server component (good for TTFB/LCP). Real numbers (LCP, INP, CLS, TTFB) will be measured on the deployed site after release and recorded as measured, not estimated.

## 11. Analytics / privacy findings

- Marketing beacon stores only a salted hash and signed touch data. Good. It carries no profile data.
- No advertising-platform pixels exist in the code (checked: no Meta/Google tag scripts). Keep it that way; the spec forbids sending sensitive matrimonial data to ad platforms.

## 12. Required improvements (feeds the build plan)

| # | Improvement | Spec § |
|---|---|---|
| 1 | Shared public shell: marketing nav (Home, How It Works, Verification, For Families, Pricing, FAQ, Support, Login, Create Profile) with a real mobile menu; signed-in links move to an "My account" entry; remove public Admin links | 6 |
| 2 | Per-page metadata helper (title, description, canonical, OG, Twitter, robots) + JSON-LD (Organization, WebSite, WebPage, BreadcrumbList, FAQPage, Article) | 25–27 |
| 3 | Sitemap for all public indexable pages + posts/guides; robots complete (+ noindex on private/utility pages) | 28, 29 |
| 4 | New pages: about, verification, for-families, for-applicants, why-life-partner-pro, safety, faq, contact; rewrite home, how-it-works (12 steps), pricing details | 3–4, 11–22 |
| 5 | Privacy and Terms expanded from the existing privacy/consent architecture and **clearly marked legal-review-sensitive** | 22, 23 |
| 6 | Blog + guides with a small admin CMS (draft/review/scheduled/published/archived, `content.*` permissions, approval where configured) | 30, 31 |
| 7 | Web app manifest, icons, install prompt (dismissible), service worker that caches **only** public static assets and an offline page, never API/private pages | 32–34 |
| 8 | Registration wizard: completion %, privacy notes at sensitive steps, optional markers, reuse `computeProfileCompleteness` | 9–11 |
| 9 | Contact/support form: categories, consent line, honeypot, connect to CRM lead (reuse STEP 28/29 services), keep `SupportMessage` | 20, 21, 40, 41 |
| 10 | Funnel events on the public site (reuse STEP 31 / STEP 29 attribution; no sensitive fields) | 38, 39, 42–44 |
| 11 | Remove/soften absolute claims (section 7) | 4, 47 |
| 12 | Image optimisation, unused SVG removal, skip link, nav labels | 35, 36 |
| 13 | Security audit + measured performance run + docs (`PUBLIC_ROUTE_MAP.md`, `SEO_IMPLEMENTATION.md`, `APPLICANT_ONBOARDING.md`) | 50–54 |

## 13. Items that need an owner decision (not decidable from the code)

1. **Public base URL**: sitemap/canonicals need `APP_URL` (currently resolves from `VERCEL_PROJECT_PRODUCTION_URL`, i.e. the `*.vercel.app` address). Until a real domain exists, SEO value is limited. Not a blocker for building.
2. **CAPTCHA/Turnstile**: none exists. Needs a Cloudflare account/site key (owner action). Until then: honeypot + rate limit + server validation.
3. **Legal wording** for privacy/terms (owner or counsel).
4. **Blog content**: topics are suggested in the spec; authoring/approving real articles is the owner's call (I will seed clearly marked draft articles only if asked).
5. **App-store apps**: only a PWA is in scope (no native apps).
