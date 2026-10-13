import type { ReactNode } from "react";
import { PageShell, PageHeading, Notice } from "@/components/public/page-kit";
import { LEGAL_LAST_UPDATED, legalPagesReviewed } from "@/lib/public-site/legal";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

// Shared layout for the privacy policy and the terms: contents list, numbered sections and the legal-review notice.
export function LegalPage({ path, title, lead, sections }: { path: string; title: string; lead: string; sections: LegalSection[] }) {
  const reviewed = legalPagesReviewed();
  return (
    <PageShell path={path} title={title} description={lead} width="max-w-3xl">
      <PageHeading title={title} lead={lead} />
      <p className="-mt-6 mb-6 text-xs text-muted">Last updated: {LEGAL_LAST_UPDATED}</p>
      {!reviewed && (
        <div className="mb-8">
          <Notice title="Wording pending legal review" tone="legal">
            This page describes how Life Partner Pro works today. It is being reviewed by the service owner and may be updated. It is not legal advice.
          </Notice>
        </div>
      )}
      <nav aria-label="Contents" className="mb-8 rounded-xl border border-border bg-surface-muted p-4 text-sm">
        <p className="font-medium">Contents</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="hover:text-foreground">{s.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="space-y-8">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`} className="font-heading text-xl font-semibold">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">{s.body}</div>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
