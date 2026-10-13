import Link from "next/link";
import { Lock, Flag, BadgeCheck, EyeOff, Search, KeyRound, Users, MapPin } from "lucide-react";
import { PageShell, PageHeading, Section, FeatureGrid, BulletList, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/safety");

export default function SafetyPage() {
  return (
    <PageShell path="/safety" title="Safety" description="Privacy, reporting and safe practices.">
      <PageHeading title="Safety and privacy" lead="What the platform does to protect you, and what you can do to protect yourself." />

      <Section title="What the platform does">
        <FeatureGrid
          items={[
            { icon: Lock, title: "Privacy", text: "No public profiles or directory. Information is limited to authorised staff and the family members you invite." },
            { icon: BadgeCheck, title: "Verification", text: "Contact confirmation, profile review and, where required, document checks." },
            { icon: EyeOff, title: "Contact protection", text: "Phone and WhatsApp details are not shown. They are shared only after mutual interest and an approved permission step." },
            { icon: Search, title: "Suspicious activity review", text: "Unusual activity is reviewed by our team. We do not publish how it is detected." },
            { icon: KeyRound, title: "Account security", text: "Sign-in uses one-time codes. Sessions can be reviewed and ended from your account." },
            { icon: Users, title: "Family participation", text: "Family access is by invitation and limited to the permissions you choose." },
          ]}
        />
      </Section>

      <Section title="What you can do">
        <BulletList
          items={[
            "Keep your sign-in codes private. Our team will never ask you for a code.",
            "Do not send money to anyone you meet through a proposal, and be cautious of anyone who asks.",
            "Share personal details gradually, and only once you are comfortable.",
            "Involve your family early and let them know where and when you are meeting.",
            "Meet in a public place for a first meeting, and tell someone you trust.",
            "Check what matters to you yourself. Verification lowers risk but cannot remove it.",
          ]}
        />
      </Section>

      <Section title="Report a concern" intro="If something does not feel right, tell us.">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
          <Flag className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-muted">
            Signed-in applicants can use <Link href="/report-concern" className="underline">Report a Concern</Link>. Anyone can contact <Link href="/support" className="underline">Support</Link>. Reports are reviewed by our team. In an emergency, contact your local emergency services first.
          </p>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> We do not publish internal detection rules or risk assessments.</p>
      </Section>

      <CtaBand title="Questions about safety?" primary={{ href: "/faq", label: "Read the FAQ" }} secondary={{ href: "/contact", label: "Contact us" }} />
    </PageShell>
  );
}
