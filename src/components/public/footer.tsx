import Link from "next/link";
import Image from "next/image";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/public-site/config";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Platform",
    links: [
      { href: "/register", label: "Create Profile" },
      { href: "/login", label: "Login" },
      { href: "/how-it-works", label: "How It Works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/for-applicants", label: "For Applicants" },
      { href: "/for-families", label: "For Families" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/verification", label: "Verification" },
      { href: "/safety", label: "Safety" },
      { href: "/why-life-partner-pro", label: "Why Life Partner Pro" },
      { href: "/about", label: "About" },
    ],
  },
  {
    title: "Learn & Help",
    links: [
      { href: "/faq", label: "FAQ" },
      { href: "/guides", label: "Guides" },
      { href: "/blog", label: "Blog" },
      { href: "/support", label: "Support" },
      { href: "/contact", label: "Contact" },
      { href: "/update-request", label: "Update My Profile" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy-policy", label: "Privacy Policy" },
      { href: "/terms", label: "Terms & Conditions" },
      { href: "/delete-account", label: "Delete Your Account" },
      { href: "/report-concern", label: "Report a Concern" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 lg:flex-row lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo-icon.png" alt="" width={28} height={28} className="h-7 w-7" />
              <span className="font-heading text-base font-semibold">{SITE_NAME}</span>
            </div>
            <p className="mt-2 max-w-xs text-sm text-muted">{SITE_TAGLINE}</p>
            <p className="mt-3 max-w-xs text-xs text-muted">A private matrimonial platform, not a dating app. Your personal information is not publicly displayed.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title} className="flex flex-col gap-2">
                <span className="font-medium text-foreground">{col.title}</span>
                {col.links.map((l) => (
                  <Link key={l.href} href={l.href} className="py-1 text-muted hover:text-foreground">
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <p className="mt-8 text-xs text-muted">
          &copy; {new Date().getFullYear()} {SITE_NAME}. Using the platform does not guarantee a match or a marriage; it provides a guided, consent-based process.
        </p>
      </div>
    </footer>
  );
}
