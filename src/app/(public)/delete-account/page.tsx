import Link from "next/link";
import { PageShell, PageHeading, Section, BulletList, Notice } from "@/components/public/page-kit";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/delete-account");

// How to ask for an account to be deleted (STEP 37 §23, §27). The same page is linked from the mobile app and from the store listings. It describes the
// real process: the request goes through the privacy workflow (review, then deletion or anonymisation); the app never deletes a database row directly.
export default function DeleteAccountPage() {
  return (
    <PageShell path="/delete-account" title="Delete your account" description="How to ask for your Life Partner Pro account and data to be deleted." width="max-w-3xl">
      <PageHeading title="Delete your account" lead="You can ask us to delete your account and the personal information we hold about you. This page explains how, and what happens next." />

      <Section title="If you can sign in">
        <BulletList
          items={[
            "Sign in on the website or in the Life Partner Pro app.",
            "Open Account Settings, then Privacy, and choose \u201CDelete my account\u201D.",
            "Confirm it is you with a one-time code we send to the e-mail address on your profile. This protects your account from someone else using your phone.",
            "Say why if you wish, then confirm the request.",
            "You receive a request reference.",
          ]}
        />
        <p className="mt-3 text-sm">
          <Link href="/account-settings" className="underline">Open Account Settings</Link>
        </p>
      </Section>

      <Section title="If you cannot sign in">
        <p className="text-sm text-muted">
          Send a request through <Link href="/contact?category=PRIVACY" className="underline">our contact form</Link>, choose &ldquo;Privacy request or question&rdquo; and give your Profile ID. We will check that the request comes from you before anything is deleted, and we may ask for a few details to do so. We will not delete an account on an unverified request.
        </p>
      </Section>

      <Section title="What happens next">
        <BulletList
          items={[
            "Your request is reviewed by our team, and there is a short cooling-off period in which you can still change your mind. Some requests need a check first, for example if a proposal, a payment or a safety report is still open.",
            "Your information is then deleted or anonymised through our privacy process, except what we must keep for legal, security or accounting reasons.",
            "Devices signed in to your account are signed out, and notifications to your phone stop.",
            "We confirm the outcome by e-mail.",
          ]}
        />
        <Notice title="Deleting the app is not the same as deleting your account">
          Removing the app from your phone does not delete your account or your information. Use the steps above to request deletion.
        </Notice>
      </Section>

      <Section title="More about your information">
        <p className="text-sm text-muted">
          The <Link href="/privacy-policy" className="underline">Privacy Policy</Link> explains what we keep, why, and for how long. You can also ask for a copy of your data or a correction from Account Settings.
        </p>
      </Section>
    </PageShell>
  );
}