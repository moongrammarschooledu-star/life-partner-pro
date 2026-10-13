import { Lock, Users, Search, UserCheck, Cpu, HeartHandshake } from "lucide-react";
import { PageShell, PageHeading, Section, FeatureGrid, Notice, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/about");

export default function AboutPage() {
  return (
    <PageShell path="/about" title="About" description="Why Life Partner Pro exists and how it approaches matchmaking.">
      <PageHeading title="About Life Partner Pro" lead="Finding the Right Life Partner, With Trust." />

      <Section title="Our purpose">
        <p className="max-w-2xl text-muted">
          Life Partner Pro is a matrimonial platform built for applicants and families who want a private, structured and respectful way to explore compatible proposals. It is a matchmaking service, not a dating network.
        </p>
      </Section>

      <Section title="How we approach it">
        <FeatureGrid
          items={[
            { icon: Lock, title: "Privacy first", text: "There is no public directory of applicants. Personal details are not publicly displayed, and contact details are shared only after a recorded permission step." },
            { icon: Users, title: "Family-friendly", text: "Families can take part when the applicant invites them, within permissions the applicant controls." },
            { icon: Search, title: "Structured matchmaking", text: "Structured profiles and clearly stated partner requirements make comparisons consistent and explainable." },
            { icon: UserCheck, title: "Human review", text: "People on our team review profiles and proposals. Software supports the work; it does not replace judgement." },
            { icon: Cpu, title: "Careful use of technology", text: "Technology is used to organise information, protect accounts and keep an audit trail, not to pressure anyone into a decision." },
            { icon: HeartHandshake, title: "Your pace", text: "Every response is yours to give. Declining a proposal is always possible." },
          ]}
        />
      </Section>

      <div className="mt-12">
        <Notice title="What we do not claim">
          We do not promise a match, a proposal or a marriage, and we do not publish success numbers. Using the platform provides a guided process; the outcome depends on the people involved.
        </Notice>
      </div>

      <CtaBand title="See how it works" primary={{ href: "/how-it-works", label: "How It Works" }} secondary={{ href: "/register", label: "Create Your Profile" }} />
    </PageShell>
  );
}
