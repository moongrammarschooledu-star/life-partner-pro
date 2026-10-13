import { Lock, ClipboardCheck, BadgeCheck, Users, UserCheck, KeyRound, MessageSquareLock, Eye } from "lucide-react";
import { PageShell, PageHeading, Section, FeatureGrid, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/why-life-partner-pro");

export default function WhyPage() {
  return (
    <PageShell path="/why-life-partner-pro" title="Why Life Partner Pro" description="What makes the platform different, explained plainly.">
      <PageHeading title="Why Life Partner Pro" lead="What the platform offers, and what each part means in practice." />
      <Section title="What you can expect">
        <FeatureGrid
          items={[
            { icon: Lock, title: "Privacy", text: "No public profiles and no searchable directory. Your information is visible only to authorised staff and to family members you invite." },
            { icon: ClipboardCheck, title: "Structured profiles", text: "Every applicant answers the same structured questions, so comparisons are consistent." },
            { icon: BadgeCheck, title: "Verification", text: "Contact confirmation, staff review and, where required, document checks. Each status is shown, not implied." },
            { icon: Users, title: "Family participation", text: "Optional, invitation-based family access with permissions the applicant sets." },
            { icon: UserCheck, title: "Admin-assisted matchmaking", text: "A person reviews matches and prepares proposals. You are not left to search alone." },
            { icon: KeyRound, title: "Consent-based contact sharing", text: "Phone and WhatsApp details are shared only after mutual interest and an explicit, recorded approval." },
            { icon: MessageSquareLock, title: "Secure communication", text: "Messages and notices go through the platform's controlled channels instead of open applicant-to-applicant chat." },
            { icon: Eye, title: "A transparent process", text: "You can see where each proposal stands and what the next step is." },
          ]}
        />
      </Section>
      <CtaBand title="Start with a private profile" primary={{ href: "/register", label: "Create Your Profile" }} secondary={{ href: "/verification", label: "How verification works" }} />
    </PageShell>
  );
}
