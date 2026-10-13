import Link from "next/link";
import { LegalPage, type LegalSection } from "@/components/public/legal-page";
import { BulletList } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/privacy-policy");

// Describes the platform as built (STEP 15/21/22/23/26): structured profile, staff review, consent-based contact sharing, optional family access,
// privacy requests. Retention periods, named processors and any country-specific notice are the owner's to supply and are deliberately not invented here.
const SECTIONS: LegalSection[] = [
  {
    id: "overview",
    title: "Overview",
    body: (
      <>
        <p>
          Life Partner Pro is a private matrimonial platform. Your information is <strong className="text-foreground">not publicly visible or searchable</strong>. There is no public directory of applicants, and search engines are told not to index private pages.
        </p>
      </>
    ),
  },
  {
    id: "data-collected",
    title: "What we collect",
    body: (
      <BulletList
        items={[
          "Profile information you give: personal details, contact details, education, profession, family background, lifestyle, partner requirements and a photo.",
          "Verification information: confirmation of your e-mail address and phone number, and any identity, education or employment documents you are asked to provide.",
          "Account and security information: sign-in activity, one-time sign-in codes and the security events needed to protect accounts.",
          "Communication information: your notification preferences and the messages we send or receive about your account, including support enquiries.",
          "Membership information: packages, orders and payment status. Card or bank details are handled by payment providers where used.",
          "Family information: details of family members you invite and the permissions you give them.",
        ]}
      />
    ),
  },
  {
    id: "purposes",
    title: "Why we use it",
    body: (
      <BulletList
        items={[
          "To create and review your profile and to identify and present suitable proposals.",
          "To verify contact details and, where required, identity and documents.",
          "To run the guided process: proposals, responses, contact sharing, meetings and family coordination.",
          "To keep the platform secure, prevent misuse and keep an audit trail of sensitive actions.",
          "To provide support, send transactional notices and, where you agree, other communications.",
          "To provide membership features and handle payments and refunds.",
        ]}
      />
    ),
  },
  {
    id: "access",
    title: "Who can see your information",
    body: (
      <BulletList
        items={[
          "Authorised staff, according to their role, to review profiles and manage the process. Sensitive actions are recorded.",
          "Family members you invite, limited to the permissions you set. You can change or withdraw access.",
          "Another applicant, only what a proposal presents under the platform's privacy rules.",
          "Contact details such as phone and WhatsApp are never shown publicly and are shared only after mutual interest and a recorded approval step.",
        ]}
      />
    ),
  },
  {
    id: "controls",
    title: "Your privacy controls",
    body: (
      <>
        <p>
          When you are signed in, the privacy area lets you request access to your data, a correction, an export, restriction of processing, withdrawal of consent or deletion. You can also manage notification preferences, family access and active sessions.
        </p>
        <p>You can also contact us at any time through the <Link href="/contact" className="underline">contact form</Link> and choose &ldquo;Privacy request or question&rdquo;.</p>
      </>
    ),
  },
  {
    id: "consent",
    title: "Consent",
    body: (
      <p>
        We ask for your agreement where it is needed, for example to store and review your profile, to share contact details, or to send marketing messages. Marketing contact is separate and optional, and you can withdraw consent at any time.
      </p>
    ),
  },
  {
    id: "documents",
    title: "Documents and photos",
    body: (
      <p>
        Verification documents are stored privately, and are accessible only to authorised staff according to the permissions configured. Photos are stored securely and are shown only to the people the platform&apos;s privacy rules allow.
      </p>
    ),
  },
  {
    id: "providers",
    title: "Service providers",
    body: (
      <p>
        We do not sell your personal information. We use service providers to run the platform, such as hosting, database and file storage, e-mail delivery, text-message or WhatsApp delivery where enabled and, where payments are enabled, payment processing. They handle information only to provide their service to us.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep information",
    body: (
      <p>
        We keep information for as long as it is needed for the purposes above and for legal, security and accounting reasons, and then remove or anonymise it according to our retention rules. If you ask for deletion, some records may need to be kept for a limited time.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        We protect information with access controls, one-time-code sign-in, audit logging, monitoring and encrypted backups. No system is completely secure, so we also ask you to keep your sign-in codes private.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: <p>We may update this policy. The date at the top shows when it last changed.</p>,
  },
];

export default function PrivacyPolicyPage() {
  return <LegalPage path="/privacy-policy" title="Privacy Policy" lead="What Life Partner Pro collects, why, who can see it and how you can control it." sections={SECTIONS} />;
}
