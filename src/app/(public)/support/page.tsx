import { Suspense } from "react";
import Link from "next/link";
import { HelpCircle, LifeBuoy, Flag, ShieldCheck, UserRound } from "lucide-react";
import { PageShell, PageHeading } from "@/components/public/page-kit";
import { Card, CardContent } from "@/components/ui/card";
import { ContactForm } from "@/components/public/contact-form";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/support");

const HELP = [
  { href: "/faq", icon: HelpCircle, title: "FAQ and help articles", text: "Answers about privacy, verification, matching and membership." },
  { href: "/my-cases", icon: LifeBuoy, title: "My support cases", text: "Signed in? Open and follow a case in your secure support centre." },
  { href: "/report-concern", icon: Flag, title: "Report a concern", text: "Signed-in applicants can report suspicious activity or a safety concern." },
  { href: "/my-privacy", icon: ShieldCheck, title: "Privacy requests", text: "Signed in? Request access, correction, export or deletion of your data." },
  { href: "/login", icon: UserRound, title: "Account help", text: "Sign-in options and what to do if you cannot sign in." },
];

// The old page showed phone, WhatsApp and e-mail "channels" with an example address and fixed opening hours. None of that was configured,
// so it was removed: the page now lists only things that exist, and every enquiry goes through the one form below.
export default function SupportPage() {
  return (
    <PageShell path="/support" title="Support" description="Find answers, contact support, report a concern or make a privacy request." width="max-w-3xl">
      <PageHeading title="Help & support" lead="Find an answer, reach the right place, or send us a message." />
      <div className="grid gap-3 sm:grid-cols-2">
        {HELP.map((h) => (
          <Link key={h.href} href={h.href} className="rounded-xl border border-border bg-surface p-4 hover:bg-surface-muted">
            <h.icon className="h-6 w-6 text-primary" aria-hidden="true" />
            <p className="mt-2 font-medium">{h.title}</p>
            <p className="mt-1 text-sm text-muted">{h.text}</p>
          </Link>
        ))}
      </div>

      <h2 className="mt-12 font-heading text-2xl font-semibold">Send us a message</h2>
      <Card className="mt-4">
        <CardContent>
          <Suspense fallback={null}>
            <ContactForm />
          </Suspense>
        </CardContent>
      </Card>
    </PageShell>
  );
}
