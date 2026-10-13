import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Lock, ClipboardCheck, BadgeCheck, Users, UserCheck, KeyRound, MessageSquareLock, Eye, Flag, ShieldCheck, ClipboardList, Search, Mail, Handshake, CalendarCheck2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JsonLd } from "@/components/public/json-ld";
import { CtaBand, FeatureGrid } from "@/components/public/page-kit";
import { FAQ_CATEGORIES, type FaqItem } from "@/lib/public-site/faq";
import { organizationLd, websiteLd, faqLd } from "@/lib/public-site/structured-data";
import { getPublicPackagesSafe } from "@/lib/public-site/packages";
import { billingPeriodLabel, priceLabel } from "@/lib/public-site/pricing-display";
import { formatMoney } from "@/lib/finance/money";
import { pageMetadata } from "@/lib/public-site/seo";
import { SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/public-site/config";

export const metadata = pageMetadata("/");

// Packages come from the live membership configuration; the page is regenerated at most every five minutes.
export const revalidate = 300;

const STEPS = [
  { icon: ClipboardList, title: "Create your profile", text: "A short, private form you can save and finish later." },
  { icon: BadgeCheck, title: "Complete verification", text: "Contact confirmation and a review by our team." },
  { icon: Search, title: "Explore potential matches", text: "Profiles are compared with your partner requirements." },
  { icon: Mail, title: "Receive or review proposals", text: "A person on our team prepares each proposal." },
  { icon: KeyRound, title: "Communicate through the guided process", text: "Contact details are shared only after mutual interest and approval." },
  { icon: Users, title: "Coordinate with family", text: "Family can take part if you invite them." },
  { icon: CalendarCheck2, title: "Meet and continue", text: "Meetings are arranged, and you decide the pace." },
];

const WHY = [
  { icon: Lock, title: "Privacy", text: "No public profiles or directory." },
  { icon: ClipboardCheck, title: "Structured profiles", text: "The same questions for everyone, so comparisons are consistent." },
  { icon: BadgeCheck, title: "Verification", text: "Contact, profile and, where required, document checks." },
  { icon: Users, title: "Family participation", text: "Optional and invitation-based." },
  { icon: UserCheck, title: "Admin-assisted matchmaking", text: "People review matches and proposals." },
  { icon: KeyRound, title: "Consent-based contact sharing", text: "Nothing is shared without a recorded approval." },
  { icon: MessageSquareLock, title: "Secure communication", text: "Controlled channels, no open chat." },
  { icon: Eye, title: "A transparent process", text: "You can see where each proposal stands." },
];

const TRUST = [
  { icon: BadgeCheck, title: "Verification", text: "Checks are shown as statuses, not implied." },
  { icon: Lock, title: "Privacy", text: "Your details are not publicly displayed." },
  { icon: Flag, title: "Reporting", text: "Report a concern and our team reviews it." },
  { icon: ShieldCheck, title: "Secure access", text: "One-time-code sign-in and reviewable sessions." },
  { icon: UserCheck, title: "Human review", text: "People, not only software, review profiles." },
  { icon: Handshake, title: "Safety workflows", text: "Suspicious activity is reviewed by our team." },
];

// A few questions from the full FAQ page; the same text, so the FAQ structured data matches what is on screen.
function homeFaq(): FaqItem[] {
  const pick = (id: string, n: number) => FAQ_CATEGORIES.find((c) => c.id === id)?.items.slice(0, n) ?? [];
  return [...pick("general", 2), ...pick("privacy", 2)];
}

export default async function HomePage() {
  const packages = await getPublicPackagesSafe();
  const faq = homeFaq();

  return (
    <>
      <JsonLd data={[organizationLd(), websiteLd(), faqLd(faq)]} />

      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-brand-pink)_0%,var(--color-primary)_45%,transparent_70%)] opacity-[0.07]" />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <Image src="/logo-icon.png" alt="" width={96} height={96} className="h-20 w-20 sm:h-24 sm:w-24" priority />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Private, structured and family-friendly
          </span>
          <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">{SITE_TAGLINE}</h1>
          <p className="max-w-2xl text-lg text-muted">{SITE_DESCRIPTION}</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link href="/register" data-cta="home-hero-create-profile" className={buttonClass({ size: "lg" })}>
              Create Your Profile <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/how-it-works" data-cta="home-hero-how-it-works" className={buttonClass({ variant: "outline", size: "lg" })}>
              How It Works
            </Link>
            <Link href="/login" data-cta="home-hero-login" className={buttonClass({ variant: "ghost", size: "lg" })}>
              Login
            </Link>
          </div>
          <p className="text-xs text-muted">Your personal information is not publicly displayed.</p>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="how-title" className="text-center font-heading text-3xl font-semibold">How it works</h2>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <Card className="h-full">
                <CardContent className="flex flex-col items-start gap-2">
                  <span className="text-xs font-semibold text-muted">STEP {i + 1}</span>
                  <s.icon className="h-7 w-7 text-primary" aria-hidden="true" />
                  <h3 className="font-medium">{s.title}</h3>
                  <p className="text-sm text-muted">{s.text}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-center text-sm">
          <Link href="/how-it-works" className="underline">See the full twelve-step process</Link>
        </p>
      </section>

      <section id="why-us" aria-labelledby="why-title" className="border-y border-border bg-surface-muted">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="why-title" className="text-center font-heading text-3xl font-semibold">Why Life Partner Pro</h2>
          <div className="mt-10">
            <FeatureGrid items={WHY} />
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="trust-title" className="text-center font-heading text-3xl font-semibold">Trust &amp; safety</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-muted">Verification lowers risk but cannot remove it. We explain what is checked and what is not.</p>
        <div className="mt-10">
          <FeatureGrid items={TRUST} />
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/verification" className="underline">How verification works</Link> · <Link href="/safety" className="underline">Safety guidance</Link>
        </p>
      </section>

      <section aria-labelledby="family-title" className="border-y border-border bg-surface-muted">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 id="family-title" className="font-heading text-3xl font-semibold">Family participation</h2>
          <p className="mt-3 text-muted">
            Families can take part when the applicant invites them, with permissions the applicant sets: review proposals, share comments and coordinate meetings. Participation is optional and always under the applicant&apos;s control.
          </p>
          <Link href="/for-families" className={buttonClass({ variant: "outline", className: "mt-6" })}>
            Learn how family access works
          </Link>
        </div>
      </section>

      <section aria-labelledby="membership-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="membership-title" className="text-center font-heading text-3xl font-semibold">Membership</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-muted">Packages provide platform features and limits. They do not guarantee a match, a response or a marriage.</p>
        {packages.length > 0 && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.slice(0, 3).map((p) => {
              const price = priceLabel(p.price, formatMoney);
              return (
                <li key={p.id}>
                  <Card className="h-full">
                    <CardContent className="space-y-1">
                      <h3 className="font-medium">{p.name}</h3>
                      <p className="text-xs text-muted">{billingPeriodLabel(p.billingType, p.durationDays)}</p>
                      <p className="text-lg font-semibold">{price.text}</p>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-6 text-center">
          <Link href="/pricing" className={buttonClass({ variant: "outline" })}>
            Explore Membership
          </Link>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="border-t border-border bg-surface-muted">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 id="faq-title" className="text-center font-heading text-3xl font-semibold">Common questions</h2>
          <div className="mt-8 divide-y divide-border rounded-xl border border-border bg-surface">
            {faq.map((item) => (
              <details key={item.question} className="p-4">
                <summary className="cursor-pointer font-medium">{item.question}</summary>
                <p className="mt-2 text-sm text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
          <p className="mt-4 text-center text-sm">
            <Link href="/faq" className="underline">See all questions</Link>
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <CtaBand title="Start Your Matrimonial Profile Today" text="It is private, and you can save your progress and finish later." primary={{ href: "/register", label: "Create Your Profile" }} secondary={{ href: "/how-it-works", label: "How It Works" }} />
      </div>
    </>
  );
}
