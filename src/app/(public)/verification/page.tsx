import Link from "next/link";
import { Smartphone, UserCheck, IdCard, FileCheck2, RefreshCw, BadgeCheck } from "lucide-react";
import { PageShell, PageHeading, Section, FeatureGrid, BulletList, Notice, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/verification");

export default function VerificationPage() {
  return (
    <PageShell path="/verification" title="Verification" description="How verification works and what it means.">
      <PageHeading title="Profile verification" lead="Verification helps reduce risk. Here is what is actually checked, what the statuses mean, and what verification cannot promise." />

      <Section title="What can be checked">
        <FeatureGrid
          items={[
            { icon: Smartphone, title: "Contact verification", text: "Your e-mail address and phone number are confirmed with one-time codes." },
            { icon: UserCheck, title: "Profile review", text: "A person on our team reviews the profile for completeness and consistency before it is used for matching." },
            { icon: IdCard, title: "Identity verification", text: "Where the current verification policy requires it, an identity document is checked." },
            { icon: FileCheck2, title: "Document review", text: "Education or employment documents may be requested where they apply. Documents are private and visible only to authorised staff." },
            { icon: RefreshCw, title: "Re-verification", text: "If key details change, or a verification expires, you may be asked to verify again." },
            { icon: BadgeCheck, title: "Verification status", text: "Your account shows where you are: not verified, pending, under review, verified, rejected, expired or re-verification required." },
          ]}
        />
      </Section>

      <Section title="What the status means">
        <BulletList
          items={[
            "Verified means the checks that were required at that time were completed. It does not mean every statement in a profile has been independently proven.",
            "Which checks are required is set by the verification policy and can change over time. The site tells you what is needed from you.",
            "A rejected or expired status can usually be resolved by submitting the requested information again.",
          ]}
        />
      </Section>

      <div className="mt-12">
        <Notice title="Honest limits">
          We do not claim that every profile is genuine. Verification lowers risk but cannot remove it. Please read our <Link href="/safety">safety guidance</Link>, verify what matters to you before meeting, and report anything that concerns you.
        </Notice>
      </div>
      <CtaBand title="Start your profile" primary={{ href: "/register", label: "Create Your Profile" }} secondary={{ href: "/safety", label: "Safety guidance" }} />
    </PageShell>
  );
}
