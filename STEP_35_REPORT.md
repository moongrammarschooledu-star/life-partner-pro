# STEP 35 Report — public website, SEO, content, PWA, onboarding and acquisition

Deployed as `8306c84` (PR #20) on 2026-10-13; follow-up fixes in the next pull request. Every number below was measured on the live site or by the test suite on the date shown; nothing is estimated. Measurements were taken on one laptop over an unreliable home connection, so treat them as lab readings, not as a performance guarantee.

## Final status

| Area | Status |
|---|---|
| Public Website | **Live.** Home, About, Why Life Partner Pro, For Applicants, For Families, Verification, Safety, How It Works (12 steps), Pricing, FAQ, Contact, Support, Blog, Guides, Login, Trouble signing in, Offline, Privacy Policy, Terms. All return 200 |
| Landing Page | Already built in STEP 29 (`/lp/[slug]`, builder, versions, UTM, consent, CRM). Verified, not rebuilt. `/campaign/:slug` and `/join` redirect (302) |
| Registration | Existing flow kept (wizard → Profile ID → e-mail-code sign-in). Authentication was **not** duplicated. Account-first order from the brief was not applied (see Known issues) |
| Applicant Onboarding | Live completion %, privacy statement, privacy notes at family / income / photo steps (English + Urdu), save and resume (device-only) |
| Family Landing Page | Live (`/for-families`) |
| Pricing | Live, server-rendered from the real package configuration; no hard-coded prices; taxes/refunds explained neutrally |
| SEO | Per-page title, description, canonical, Open Graph, Twitter, indexing from one registry; verified on 12 live pages |
| Sitemap | Live: 17 URLs (all indexable pages). Blog/guides appear when published and not `noindex` (verified with a test article) |
| Robots | Live; disallows `/admin /api/ /dashboard /family /my- /account-settings /maintenance /private /internal` |
| Structured Data | Organization, WebSite, WebPage, BreadcrumbList, FAQPage, Article. No ratings or reviews |
| PWA | Manifest, icons, service worker, offline page live. Service worker verified on the live site: its cache holds only JS/CSS/fonts, two icons and `/offline` — no page, no API response |
| Mobile | Working mobile menu (the old navigation disappeared on phones); phone navigation for signed-in applicants; header tightened in the follow-up |
| Lead Capture | Contact form → support inbox with category and consent (validation, honeypot, same-origin, duplicate guard, size cap verified live). Landing-page lead forms: STEP 29 |
| CRM Integration | Landing-page leads: STEP 29 (unchanged). Contact enquiries go to the support inbox, not CRM leads, on purpose (an enquiry is not marketing consent) |
| Analytics | Anonymous visitor counter built, **off by default** (`marketing.site_events.enabled`); funnel page live at Admin → Public Website |
| Security | See below |
| Accessibility | Scripted checks, 0 structural issues on 7 pages; one real contrast problem found and fixed (follow-up). Not a full audit |

## Performance (measured 2026-10-13, live site)

Server response, `curl`, 5 runs each, from the same laptop (TLS set-up alone took 0.6–1.5 s on this connection, so most of each number is network):

| Page | TTFB min / median / max | Compressed HTML |
|---|---|---|
| `/` | 0.89 / 1.87 / 3.95 s | 14 KB (87 KB decoded) |
| `/pricing` | 1.08 / 1.70 / 3.75 s | 7 KB (40 KB decoded) |
| `/how-it-works` | 0.83 / 1.11 / 2.05 s | 11 KB |
| `/faq` | 0.65 / 0.85 / 1.35 s | 10 KB (72 KB decoded) |
| `/blog` | 0.97 / 1.01 / 2.86 s | 6 KB |
| `/robots.txt` (tiny static) | 0.66 / 0.79 / 0.90 s | 0.3 KB |

The tiny static file shows the connection overhead of this machine (~0.7 s); the extra time on a page is the server's work (roughly 0.1–0.5 s).

In-app browser, 375×812 phone viewport, no throttling:

| Page | TTFB | FCP | LCP | CLS | Load event |
|---|---|---|---|---|---|
| `/` | 337 ms | 848 ms | 848 ms (the intro paragraph) | 0 | 853 ms |
| `/how-it-works` | 855 ms | — | not captured | 0 | 2.6 s |
| `/faq` | 387 ms | — | not captured | 0 | 8.3 s |
| `/pricing` | 353 ms | — | not captured | 0 | 5.7 s |

Honest notes: the slow load events on three pages were caused by all script files stalling together on this machine's connection (the same pages loaded fast on other runs); LCP was only captured on the home page (the other tabs were in the background, where browsers do not report it); **INP was not measured**; this is not Lighthouse. Page layout never shifted (CLS 0 everywhere). `public/` shrank from 1,123 KB to 88 KB.

## Accessibility (scripted checks, 2026-10-13)

On `/`, `/faq`, `/contact`, `/login`, `/register`, `/privacy-policy`, `/for-families`: page language set, exactly one `h1`, no skipped heading levels, one `main`, labelled navigation landmarks, skip link present and its target exists, every image has `alt`, every link/button has an accessible name, every form control has a label, no duplicate ids, no positive tab indexes — **0 issues**. Text contrast over 450 text elements: the secondary "muted" text colour was 3.7:1 on the page background (needs 4.5:1); darkened to 5.9:1 in the follow-up. Small targets: only text links with enough spacing (allowed by WCAG 2.2); footer links gained padding. **Not done:** axe-core (could not be loaded in the app browser), manual keyboard walk-through, screen-reader test.

## Security and privacy checks

- Tests: 222 files, 2,752 tests pass; `tsc`, `eslint` clean; `security-scan` PASS; `check-migrations` (36); deploy gate success.
- Live: private areas answer `X-Robots-Tag: noindex, nofollow, noarchive` (verified for 8 paths); public pages carry no noindex header; `robots.txt` as above.
- Live: article text containing `<script>`, an `onerror` image and a `javascript:` link rendered as harmless plain text; internal link kept; `noindex` honoured; not in the sitemap; Article JSON-LD present.
- Live: content policy blocked an article claiming a guaranteed perfect match (HTTP 422).
- Live: contact API — bad input 400, missing consent 400, link in message 400, filled honeypot silently ignored (nothing stored), oversize body 413.
- Service worker never intercepts API calls or non-GET requests; verified with the real worker in a sandbox (tests) and by inspecting the live cache.
- No public applicant directory, no dating/social features, no advertising or analytics script, no sensitive attribute in any visitor event.
- Reviewed exception in `scripts/security-scan.mjs`: `dangerouslySetInnerHTML` is allowed in exactly one file (the JSON-LD component) and only for `serializeJsonLd()` output.
- Not tested: automated CSRF/IDOR scanners, penetration test of the new routes (the route audit and unit tests cover guards and inputs only).

## Known issues

1. **No CAPTCHA/Turnstile** — needs an owner-created key; honeypot, rate limit, same-origin check and validation protect the forms meanwhile.
2. **Registration order** differs from the brief (no account-first step; sign-in is Profile ID + e-mail code). Left as is to avoid rewriting authentication.
3. **Family accounts have no self-service password reset**; the public page says so honestly.
4. **Privacy policy and terms are unreviewed by a lawyer**; a "pending legal review" notice shows until `LEGAL_PAGES_REVIEWED=true`. No retention periods or named processors were invented.
5. **No articles seeded**; blog and guides are empty until staff write and publish.
6. Main-site UTM/campaign values are not stored (landing pages store them).
7. Registration draft is kept in the browser's local storage on that device.
8. No applicant "Meetings" tab on the phone navigation: no applicant meetings page exists.
9. The install suggestion and install flow were not tested on a real phone.
10. Authors and categories cannot be deleted from the admin screen (only created).
11. Blog/guide pages refresh at most every 5 minutes, so an archived item can stay visible that long (list pages update immediately).

## Production blockers

None. The release is live and healthy. Production Readiness shows one open item, **"Current release approved"**, which needs the owner's Approve click for each new build (same as after every deploy).

## Remaining manual configuration (owner)

1. Approve the newest release in Admin → Production Readiness → Releases.
2. Set `APP_URL` to the real domain when there is one (the `*.vercel.app` address works but has little search value); submit `/sitemap.xml` in Google Search Console / Bing Webmaster Tools.
3. Have the privacy policy and terms reviewed; then set `LEGAL_PAGES_REVIEWED=true` (and `LEGAL_GOVERNING_LAW` with your own wording).
4. Write and approve the first articles and guides (Admin → Blog & Guides). An author, "Life Partner Pro Editorial Team", already exists.
5. Optional: turn on `marketing.enabled` and `marketing.site_events.enabled` to count visits; turn on `content.approval_required` if a second person should approve articles.
6. Optional: create a Cloudflare Turnstile key for the forms.
