import Link from "next/link";
import { PageShell, PageHeading, CtaBand } from "@/components/public/page-kit";
import { JsonLd } from "@/components/public/json-ld";
import { FAQ_CATEGORIES, allFaqItems } from "@/lib/public-site/faq";
import { faqLd } from "@/lib/public-site/structured-data";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/faq");

export default function FaqPage() {
  return (
    <PageShell path="/faq" title="FAQ" description="Answers about privacy, verification, matching, proposals, family participation, safety and membership.">
      {/* The structured data is generated from the same list that is rendered, so the markup always matches the visible text. */}
      <JsonLd data={faqLd(allFaqItems())} />
      <PageHeading title="Frequently asked questions" lead="Straight answers about how the platform works." />

      <nav aria-label="FAQ categories" className="mb-8 flex flex-wrap gap-2 text-sm">
        {FAQ_CATEGORIES.map((c) => (
          <a key={c.id} href={`#${c.id}`} className="rounded-full border border-border px-3 py-1 text-muted hover:text-foreground">
            {c.title}
          </a>
        ))}
      </nav>

      <div className="space-y-10">
        {FAQ_CATEGORIES.map((c) => (
          <section key={c.id} id={c.id} aria-labelledby={`${c.id}-title`}>
            <h2 id={`${c.id}-title`} className="font-heading text-2xl font-semibold">{c.title}</h2>
            <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-surface">
              {c.items.map((item) => (
                <details key={item.question} className="group p-4">
                  <summary className="cursor-pointer list-none font-medium marker:hidden">
                    <span className="flex items-start justify-between gap-3">
                      {item.question}
                      <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-2 text-sm text-muted">{item.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-sm text-muted">
        Still have a question? <Link href="/contact" className="underline">Contact us</Link> or visit <Link href="/support" className="underline">Support</Link>.
      </p>
      <CtaBand title="Ready to start?" primary={{ href: "/register", label: "Create Your Profile" }} secondary={{ href: "/how-it-works", label: "How It Works" }} />
    </PageShell>
  );
}
