import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/public/legal-page";
import { BulletList } from "@/components/public/page-kit";
import { governingLawText } from "@/lib/public-site/legal";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/terms");

// Plain-language terms for how the platform works today. The governing-law section appears only when the owner supplies the wording
// (LEGAL_GOVERNING_LAW); no legal requirement is invented here.
function buildSections(): LegalSection[] {
  const law = governingLawText();
  const sections: LegalSection[] = [
    {
      id: "about",
      title: "What Life Partner Pro is",
      body: (
        <p>
          Life Partner Pro is a private matrimonial platform that facilitates introductions through a guided, consent-based process. It is not a dating network. It does not guarantee a match, a proposal, a response or a marriage, and it does not arrange or perform marriages.
        </p>
      ),
    },
    {
      id: "accounts",
      title: "Accounts and your responsibilities",
      body: (
        <BulletList
          items={[
            "You confirm that the information you give is accurate and complete to the best of your knowledge and that you are using the platform for genuine matrimonial purposes.",
            "Keep your sign-in codes private. You are responsible for activity under your account.",
            "Tell us promptly if your information changes or your account may have been misused.",
          ]}
        />
      ),
    },
    {
      id: "acceptable-use",
      title: "Acceptable use and prohibited misuse",
      body: (
        <BulletList
          items={[
            "Do not give false information, impersonate anyone, or create a profile for someone without their knowledge.",
            "Do not harass, pressure or threaten anyone, or use the platform for dating-style, commercial, advertising or any non-matrimonial purpose.",
            "Do not ask anyone for money, or share another person's information outside the guided process.",
            "Do not attempt to access other accounts, scrape information, or interfere with the platform's security.",
          ]}
        />
      ),
    },
    {
      id: "verification",
      title: "Verification and its limits",
      body: (
        <p>
          We check what the verification policy requires, and a person on our team reviews profiles. Verification lowers risk but cannot guarantee that every statement in a profile is accurate. Please take your own care before relying on any information, and read our <Link href="/safety" className="underline">safety guidance</Link>.
        </p>
      ),
    },
    {
      id: "communication",
      title: "Communication rules",
      body: (
        <p>
          Contact between applicants and families happens through the guided process. Contact details are shared only after mutual interest and an approval step. You must use shared details only for the matrimonial discussion they were shared for.
        </p>
      ),
    },
    {
      id: "restrictions",
      title: "Account restrictions and termination",
      body: (
        <p>
          We may restrict, suspend, archive or remove an account that breaks these terms or puts others at risk. You can ask to close your account at any time through the privacy area or Support. Some records may be kept for a limited time for legal, security or accounting reasons.
        </p>
      ),
    },
    {
      id: "membership",
      title: "Membership and payments",
      body: (
        <>
          <p>
            Packages provide the platform features and limits shown on the <Link href="/pricing" className="underline">pricing page</Link>, for the price and billing period shown. A package does not guarantee any matrimonial outcome. Taxes, where configured, are shown before you pay.
          </p>
          <p>Refunds, where applicable, follow the refund note for the package and are decided by our team.</p>
        </>
      ),
    },
    {
      id: "ip",
      title: "Intellectual property",
      body: <p>The platform, its design and its content belong to Life Partner Pro or its licensors. You keep ownership of the information you provide and allow us to use it to provide the service described in the Privacy Policy.</p>,
    },
    {
      id: "disclaimers",
      title: "Disclaimers and liability",
      body: (
        <p>
          The platform is provided as a facilitation service. We do not control the conduct of applicants or families and are not responsible for decisions made between them. The extent to which liability can be limited depends on the law that applies to you.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes to these terms",
      body: <p>We may update these terms. The date at the top shows when they last changed. Continuing to use the platform after a change means you accept the updated terms.</p>,
    },
  ];
  if (law) sections.push({ id: "governing-law", title: "Governing law", body: <p>{law}</p> });
  return sections;
}

export default function TermsPage() {
  return <LegalPage path="/terms" title="Terms & Conditions" lead="The terms for using Life Partner Pro, in plain language." sections={buildSections()} />;
}
