import Link from "next/link";
import { PageShell, PageHeading, Section, BulletList, Notice, CtaBand } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/for-applicants");

export default function ForApplicantsPage() {
  return (
    <PageShell path="/for-applicants" title="For Applicants" description="What to expect as an applicant.">
      <PageHeading title="For applicants" lead="What you are asked, why we ask it, and what happens next." />

      <Section title="Creating your profile">
        <BulletList
          items={[
            "The form has several short steps: basic details, contact, education and profession, family, lifestyle, partner requirements, a photo and a final review.",
            "You can save your progress on your device and come back later. Nothing is submitted until you confirm on the last step.",
            "Optional sections are marked as optional. You are not asked for more than a step needs.",
            "You receive a Profile ID. You sign in with it and your e-mail address, using a one-time code sent to that address.",
          ]}
        />
      </Section>

      <Section title="Who can see your profile">
        <BulletList
          items={[
            "Not the public, and not search engines. There is no applicant directory.",
            "Authorised staff, to review and match profiles.",
            "Family members you invite, limited to what you allow.",
            "Another applicant sees only what a proposal presents. Contact details come later, after mutual interest and an approval step.",
          ]}
        />
      </Section>

      <Section title="After you submit">
        <BulletList
          items={[
            "Your contact details are confirmed and a person on our team reviews the profile.",
            "Documents may be requested where the verification policy requires them.",
            "Once reviewed, your profile can be considered for matching. You can follow progress from your dashboard.",
          ]}
        />
        <p className="mt-4 text-sm text-muted">
          Read the full <Link href="/how-it-works" className="underline">process</Link>, the <Link href="/verification" className="underline">verification</Link> details and the <Link href="/faq" className="underline">FAQ</Link>.
        </p>
      </Section>

      <div className="mt-12">
        <Notice title="No guarantee">Creating a profile starts a process. It does not guarantee proposals, a match or a marriage.</Notice>
      </div>
      <CtaBand title="Create Your Profile" text="It is private, and you can pause and resume." primary={{ href: "/register", label: "Create Your Profile" }} />
    </PageShell>
  );
}
