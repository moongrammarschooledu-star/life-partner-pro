import Link from "next/link";
import Image from "next/image";
import { ShieldCheck, Sparkles, Lock, HeartHandshake, Users, ArrowRight, ClipboardList, Search, MessagesSquare, Handshake } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const HOW_IT_WORKS = [
  { icon: ClipboardList, title: "Submit Your Details", description: "Complete our private, secure registration form with your profile and partner preferences." },
  { icon: Search, title: "Our Admin Reviews Your Profile", description: "A member of our team personally reviews and verifies every submission." },
  { icon: Sparkles, title: "Suitable Matches Are Identified", description: "Our matching system highlights compatible profiles for admin review." },
  { icon: MessagesSquare, title: "Families/Individuals Are Connected", description: "With your consent, we facilitate an introduction between the two sides." },
  { icon: Handshake, title: "Take the Next Step Together", description: "Meetings are arranged and followed up until a decision is reached." },
];

const WHY_US = [
  { icon: Lock, title: "Privacy First", description: "Your details are never publicly visible or searchable — only authorized admins can see them." },
  { icon: ShieldCheck, title: "Admin Verified Profiles", description: "Every profile is reviewed and verified by our team before matching begins." },
  { icon: Sparkles, title: "Smart Matching", description: "A transparent, weighted compatibility score highlights the most suitable proposals." },
  { icon: HeartHandshake, title: "Personalized Service", description: "Real people manage your matchmaking journey from start to finish." },
  { icon: Lock, title: "Secure Information", description: "Contact details are shared only with explicit admin approval, fully audited." },
  { icon: Users, title: "Family-Friendly Approach", description: "Built for serious, respectful, family-oriented matchmaking — not casual dating." },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-brand-pink)_0%,var(--color-primary)_45%,transparent_70%)] opacity-[0.07]" />
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 sm:py-28">
          <Image src="/logo-icon.png" alt="Life Partner Pro" width={96} height={96} className="h-20 w-20 sm:h-24 sm:w-24" priority />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
            <Lock className="h-3.5 w-3.5" /> Private &amp; admin-managed matchmaking
          </span>
          <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-6xl">Life Partner Pro</h1>
          <p className="max-w-xl text-lg text-muted">Finding the Right Life Partner, With Trust.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className={buttonClass({ size: "lg" })}>
              Register Your Profile <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="#how-it-works" className={buttonClass({ variant: "outline", size: "lg" })}>
              How It Works
            </Link>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center font-heading text-3xl font-semibold">How It Works</h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {HOW_IT_WORKS.map((step, i) => (
            <Card key={step.title} className="relative">
              <CardContent className="flex flex-col items-start gap-3">
                <span className="text-xs font-semibold text-muted">STEP {i + 1}</span>
                <step.icon className="h-8 w-8 text-primary" />
                <p className="font-medium">{step.title}</p>
                <p className="text-sm text-muted">{step.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section id="why-us" className="border-y border-border bg-surface-muted">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="text-center font-heading text-3xl font-semibold">Why Life Partner Pro?</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_US.map((item) => (
              <Card key={item.title}>
                <CardContent className="flex flex-col items-start gap-3">
                  <item.icon className="h-8 w-8 text-primary" />
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h2 className="font-heading text-3xl font-semibold">Start Your Matrimonial Profile Today</h2>
        <p className="mt-3 text-muted">
          Submit your details privately — our team will personally review your profile and begin finding suitable proposals.
        </p>
        <Link href="/register" className={buttonClass({ size: "lg", className: "mt-6" })}>
          Register Your Profile <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </>
  );
}
