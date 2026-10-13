import { Suspense } from "react";
import { PageShell, PageHeading } from "@/components/public/page-kit";
import { Card, CardContent } from "@/components/ui/card";
import { ContactForm } from "@/components/public/contact-form";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/contact");

// Enquiries land in the existing support inbox (the admin Support screen), with the category chosen here. No staff e-mail address, phone
// number or opening hours are shown, because none are configured for publication.
export default function ContactPage() {
  return (
    <PageShell path="/contact" title="Contact" description="Send a general, technical or privacy-related enquiry." width="max-w-2xl">
      <PageHeading title="Contact us" lead="Send us a message and our team will reply by e-mail. Choose the topic that fits best so it reaches the right person." />
      <Card>
        <CardContent>
          <Suspense fallback={null}>
            <ContactForm />
          </Suspense>
        </CardContent>
      </Card>
    </PageShell>
  );
}
