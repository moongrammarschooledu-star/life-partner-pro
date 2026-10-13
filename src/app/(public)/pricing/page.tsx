import { PageShell, PageHeading, Notice, CtaBand } from "@/components/public/page-kit";
import { PricingPackages } from "@/components/public/pricing-packages";
import { pageMetadata } from "@/lib/public-site/seo";
import { getPublicPackagesSafe } from "@/lib/public-site/packages";

export const metadata = pageMetadata("/pricing");

// Regenerated at most every five minutes, so a price change shows up quickly without a database read on every visit.
export const revalidate = 300;

// STEP 27: the packages shown here are the live configuration (see PricingPackages). The wording around them is neutral on purpose:
// a package provides platform features and limits, never a better or guaranteed matrimonial outcome.
export default async function PricingPage() {
  const packages = await getPublicPackagesSafe();
  return (
    <PageShell path="/pricing" title="Pricing" description="Available membership packages, their features, billing period and price." width="max-w-5xl">
      <PageHeading title="Membership & packages" lead="Platform features and limits, as currently configured by our team. They may change over time." />
      <PricingPackages packages={packages} />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Notice title="How to read a package">
          <ul className="list-disc space-y-1 pl-4">
            <li><strong>Free</strong> packages have no charge.</li>
            <li><strong>One-time</strong> packages are paid once.</li>
            <li><strong>Subscription</strong> packages renew each billing period shown.</li>
          </ul>
        </Notice>
        <Notice title="Taxes and refunds">
          Applicable taxes, where configured for your country, are calculated and shown at checkout before you pay. Refunds, where applicable, follow the refund note for the package and are handled by our team.
        </Notice>
      </div>
      <div className="mt-6">
        <Notice title="No guarantee">
          Packages provide platform features and services. They do not guarantee a match, a response or a marriage, and a different package does not mean a better outcome.
        </Notice>
      </div>
      <CtaBand title="Not sure which features you need?" primary={{ href: "/faq", label: "Read the FAQ" }} secondary={{ href: "/register", label: "Create Your Profile" }} />
    </PageShell>
  );
}
