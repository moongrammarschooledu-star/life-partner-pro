import { Suspense } from "react";
import { PageShell, PageHeading } from "@/components/public/page-kit";
import { Card, CardContent } from "@/components/ui/card";
import { ContactForm } from "@/components/public/contact-form";
import { pageMetadata } from "@/lib/public-site/seo";
import { getSettingValues } from "@/lib/platform/settings";

export const metadata = pageMetadata("/contact");
export const revalidate = 300;

// Enquiries land in the existing support inbox (the admin Support screen), with the category chosen here. Contact details appear below ONLY when an
// administrator has entered them in Control Center > Branding and public contact; until then nothing is shown (no invented address, phone or hours).
export default async function ContactPage() {
  const s = await getSettingValues().catch(() => ({}) as Record<string, unknown>);
  const text = (k: string) => (typeof s[k] === "string" ? (s[k] as string).trim() : "");
  const email = text("contact.public_email");
  const phone = text("contact.public_phone");
  const whatsapp = text("contact.public_whatsapp");
  const address = text("contact.public_address");
  const hours = text("contact.support_hours");
  const any = email || phone || whatsapp || address || hours;
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
      {any && (
        <dl className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-2">
          {email && <div><dt className="text-xs text-muted">E-mail</dt><dd><a className="underline" href={`mailto:${email}`}>{email}</a></dd></div>}
          {phone && <div><dt className="text-xs text-muted">Phone</dt><dd>{phone}</dd></div>}
          {whatsapp && <div><dt className="text-xs text-muted">WhatsApp</dt><dd>{whatsapp}</dd></div>}
          {hours && <div><dt className="text-xs text-muted">Support hours</dt><dd>{hours}</dd></div>}
          {address && <div className="sm:col-span-2"><dt className="text-xs text-muted">Address</dt><dd>{address}</dd></div>}
        </dl>
      )}
    </PageShell>
  );
}