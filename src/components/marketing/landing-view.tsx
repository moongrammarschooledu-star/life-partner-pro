"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { LeadForm } from "@/components/marketing/lead-form";
import type { LandingSection } from "@/lib/marketing/landing-schema";
import type { RenderedForm } from "@/lib/marketing/landing-render";

// STEP 29 §9 — renders the structured landing sections. Content is React text only (no raw HTML), so there is no
// injection surface. The page view and CTA clicks are reported through the first-party, signed-token beacon.

function beacon(type: "LANDING_PAGE_VIEW" | "CTA_CLICK", touch: string) {
  try {
    void fetch("/api/marketing/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, touch }), keepalive: true });
  } catch {
    // never affects the page
  }
}

function Cta({ label, href, touch, variant }: { label: string; href: string; touch: string; variant?: "primary" | "outline" }) {
  const external = /^https:\/\//i.test(href);
  const cls = buttonClass({ variant: variant ?? "primary", size: "lg" });
  return external ? (
    <a href={href} className={cls} rel="noopener noreferrer" onClick={() => beacon("CTA_CLICK", touch)}>{label}</a>
  ) : (
    <Link href={href} className={cls} onClick={() => beacon("CTA_CLICK", touch)}>{label}</Link>
  );
}

export function LandingView({ sections, forms, touchToken, language }: { sections: LandingSection[]; forms: Record<string, RenderedForm>; touchToken: string; language: "EN" | "UR" }) {
  useEffect(() => {
    beacon("LANDING_PAGE_VIEW", touchToken);
  }, [touchToken]);

  return (
    <div dir={language === "UR" ? "rtl" : "ltr"} lang={language === "UR" ? "ur" : "en"} className="mx-auto max-w-3xl space-y-10 px-4 py-10">
      {sections.map((s) => {
        switch (s.type) {
          case "HERO":
            return (
              <section key={s.id} className="space-y-4 text-center">
                <h1 className="font-heading text-3xl font-semibold sm:text-4xl">{s.heading}</h1>
                {s.subtitle && <p className="text-lg text-muted">{s.subtitle}</p>}
                {s.ctaLabel && s.ctaHref && <Cta label={s.ctaLabel} href={s.ctaHref} touch={touchToken} />}
              </section>
            );
          case "TEXT":
            return (
              <section key={s.id} className="space-y-2">
                <h2 className="font-heading text-2xl font-semibold">{s.heading}</h2>
                <p className="whitespace-pre-line text-muted">{s.body}</p>
              </section>
            );
          case "BENEFITS":
          case "STEPS":
            return (
              <section key={s.id} className="space-y-4">
                <h2 className="font-heading text-2xl font-semibold">{s.heading}</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {s.items.map((it, i) => (
                    <li key={i} className="rounded-xl border border-border bg-surface p-4">
                      <p className="font-medium">{s.type === "STEPS" ? `${i + 1}. ` : ""}{it.title}</p>
                      <p className="mt-1 text-sm text-muted">{it.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "FAQ":
            return (
              <section key={s.id} className="space-y-3">
                <h2 className="font-heading text-2xl font-semibold">{s.heading}</h2>
                {s.items.map((f, i) => (
                  <details key={i} className="rounded-xl border border-border bg-surface p-4">
                    <summary className="cursor-pointer font-medium">{f.q}</summary>
                    <p className="mt-2 text-sm text-muted">{f.a}</p>
                  </details>
                ))}
              </section>
            );
          case "PROCESS_TRUST":
            return (
              <section key={s.id} className="space-y-3">
                <h2 className="font-heading text-2xl font-semibold">{s.heading}</h2>
                <ul className="list-disc space-y-1 ps-5 text-muted">
                  {s.statements.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </section>
            );
          case "CTA":
            return (
              <section key={s.id} className="space-y-3 rounded-xl border border-border bg-surface p-6 text-center">
                <h2 className="font-heading text-2xl font-semibold">{s.heading}</h2>
                {s.body && <p className="text-muted">{s.body}</p>}
                <Cta label={s.ctaLabel} href={s.ctaHref} touch={touchToken} />
              </section>
            );
          case "FORM_EMBED": {
            const form = forms[s.formId];
            return (
              <section key={s.id} className="space-y-3">
                {s.heading && <h2 className="font-heading text-2xl font-semibold">{s.heading}</h2>}
                {form ? <LeadForm formId={form.formId} fields={form.fields} consentConfig={form.consentConfig} touchToken={touchToken} language={language} /> : <p className="text-sm text-muted">This form is not available right now.</p>}
              </section>
            );
          }
          case "DISCLAIMER":
            return (
              <p key={s.id} className="border-t border-border pt-4 text-xs text-muted">
                {s.body}
              </p>
            );
        }
      })}
    </div>
  );
}
