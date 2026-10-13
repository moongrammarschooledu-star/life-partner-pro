import { UserPlus, SlidersHorizontal, Eye, MessageSquare, CalendarCheck2, ShieldCheck } from "lucide-react";
import { PageShell, PageHeading, Section, FeatureGrid, Notice, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/for-families");

export default function ForFamiliesPage() {
  return (
    <PageShell path="/for-families" title="For Families" description="Optional, invitation-based family participation.">
      <PageHeading title="For families" lead="Marriage often involves the whole family. Family participation here is optional, invited by the applicant and limited to the permissions the applicant sets." />

      <Section title="How family access works">
        <FeatureGrid
          items={[
            { icon: UserPlus, title: "Invitation-based", text: "A family member can only join when the applicant sends an invitation. There is no way to look an applicant up." },
            { icon: SlidersHorizontal, title: "Delegated permissions", text: "The applicant chooses what each family member may do, for example view, comment or suggest, and can change or withdraw that at any time." },
            { icon: Eye, title: "Proposal review", text: "With permission, family members can review proposals alongside the applicant." },
            { icon: MessageSquare, title: "Family comments", text: "Family members can share their views on a proposal so everyone sees the same discussion." },
            { icon: CalendarCheck2, title: "Meeting coordination", text: "Meetings between families can be coordinated in one place." },
            { icon: ShieldCheck, title: "Controlled participation", text: "Family members sign in separately. They see only what their permissions allow, and their activity is recorded." },
          ]}
        />
      </Section>

      <div className="mt-12">
        <Notice title="The applicant stays in control">Family participation never replaces the applicant&apos;s own consent. If the applicant removes access, it ends.</Notice>
      </div>

      <CtaBand
        title="Start with the applicant&apos;s profile"
        text="Family access is set up from the applicant&apos;s account once the profile exists."
        primary={{ href: "/register", label: "Create Applicant Profile" }}
        secondary={{ href: "/how-it-works", label: "Learn How Family Access Works" }}
      />
    </PageShell>
  );
}
