import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JsonLd } from "@/components/public/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/public-site/structured-data";
import { cn } from "@/lib/utils";

// Small building blocks shared by the public pages, so every page has the same structure, headings order and spacing.

export function PageShell({ path, title, description, crumbs, children, width = "max-w-4xl" }: { path: string; title: string; description: string; crumbs?: Array<{ name: string; path: string }>; children: ReactNode; width?: string }) {
  const trail = [{ name: "Home", path: "/" }, ...(crumbs ?? []), { name: title, path }];
  return (
    <>
      <JsonLd data={[webPageLd({ path, name: title, description }), breadcrumbLd(trail)]} />
      <div className={cn("mx-auto px-4 py-12 sm:px-6 sm:py-16", width)}>
        <nav aria-label="Breadcrumb" className="mb-6 text-xs text-muted">
          <ol className="flex flex-wrap items-center gap-1">
            {trail.map((t, i) => (
              <li key={t.path} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
                {i === trail.length - 1 ? <span aria-current="page">{t.name}</span> : <Link href={t.path} className="hover:text-foreground">{t.name}</Link>}
              </li>
            ))}
          </ol>
        </nav>
        {children}
      </div>
    </>
  );
}

export function PageHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <header className="mb-10">
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
      {lead && <p className="mt-3 max-w-2xl text-lg text-muted">{lead}</p>}
    </header>
  );
}

export function Section({ title, intro, children, className }: { title: string; intro?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-12", className)}>
      <h2 className="font-heading text-2xl font-semibold">{title}</h2>
      {intro && <p className="mt-2 max-w-2xl text-muted">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  text: string;
}

export function FeatureGrid({ items, columns = 3 }: { items: FeatureItem[]; columns?: 2 | 3 }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
      {items.map((item) => (
        <Card key={item.title}>
          <CardContent className="flex flex-col items-start gap-2">
            <item.icon className="h-7 w-7 text-primary" aria-hidden="true" />
            <h3 className="font-medium">{item.title}</h3>
            <p className="text-sm text-muted">{item.text}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-muted">
      {items.map((i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

export function Notice({ title, children, tone = "info" }: { title: string; children: ReactNode; tone?: "info" | "legal" }) {
  return (
    <aside className={cn("rounded-xl border p-4 text-sm", tone === "legal" ? "border-amber-400/60 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : "border-border bg-surface-muted")}>
      <p className="font-medium">{title}</p>
      <div className="mt-1 text-muted [&_a]:underline">{children}</div>
    </aside>
  );
}

export function CtaBand({ title, text, primary, secondary }: { title: string; text?: string; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <section className="mt-16 rounded-2xl border border-border bg-surface-muted px-6 py-10 text-center">
      <h2 className="font-heading text-2xl font-semibold">{title}</h2>
      {text && <p className="mx-auto mt-2 max-w-xl text-muted">{text}</p>}
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href={primary.href} data-cta="cta-band-primary" className={buttonClass({ size: "lg" })}>
          {primary.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        {secondary && (
          <Link href={secondary.href} className={buttonClass({ variant: "outline", size: "lg" })}>
            {secondary.label}
          </Link>
        )}
      </div>
    </section>
  );
}
