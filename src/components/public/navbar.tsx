"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Moon, Sun, Lock, CreditCard, LayoutDashboard, Menu, X, type LucideIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { buttonClass } from "@/components/ui/button";
import { NotificationBell } from "@/components/public/notification-bell";
import { isApplicantAppPath } from "@/lib/public-site/routes";
import { cn } from "@/lib/utils";

// The same links on desktop and in the mobile menu (spec §6). Visitors see the marketing links; a signed-in applicant moving through the
// account pages (/dashboard, /my-*, ...) keeps the account links they already had. There is no staff/admin link here: staff open /admin/login directly.
type NavLink = { href: string; label: string; icon?: LucideIcon };

const MARKETING_LINKS: NavLink[] = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/verification", label: "Verification" },
  { href: "/for-families", label: "For Families" },
  { href: "/pricing", label: "Pricing" },
  { href: "/faq", label: "FAQ" },
  { href: "/support", label: "Support" },
];

const ACCOUNT_LINKS: NavLink[] = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/my-verification", label: "My Verification" },
  { href: "/my-proposals", label: "My Proposals" },
  { href: "/my-notifications", label: "My Notifications" },
  { href: "/my-cases", label: "Help & Support" },
  { href: "/account-settings", label: "Account & Privacy", icon: Lock },
  { href: "/my-billing", label: "Packages", icon: CreditCard },
  { href: "/support", label: "Contact Us" },
];

export function PublicNavbar() {
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const accountMode = isApplicantAppPath(pathname);
  const links = accountMode ? ACCOUNT_LINKS : MARKETING_LINKS;

  // Close the mobile menu after every navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const linkClass = (href: string) => cn("text-muted hover:text-foreground", pathname === href && "text-foreground");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="Life Partner Pro — home">
          <Image src="/logo-icon.png" alt="" width={32} height={32} className="h-8 w-8" priority />
          <span className="font-heading text-lg font-semibold">Life Partner Pro</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-5 text-sm font-medium lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined} className={cn("flex items-center gap-1", linkClass(l.href))}>
              {l.icon ? <l.icon className="h-4 w-4" aria-hidden="true" /> : null}
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {!accountMode && (
            <>
              <Link href="/login" className={buttonClass({ variant: "outline", size: "sm", className: "hidden sm:inline-flex" })}>
                Login
              </Link>
              <Link href="/register" data-cta="nav-create-profile" className={buttonClass({ size: "sm" })}>
                Create Profile
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-menu" aria-label="Mobile" className="border-t border-border bg-surface lg:hidden">
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-2 sm:px-6">
            <li>
              <Link href="/" className="block py-3 text-sm font-medium">Home</Link>
            </li>
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} aria-current={pathname === l.href ? "page" : undefined} className="block py-3 text-sm font-medium">
                  {l.label}
                </Link>
              </li>
            ))}
            {!accountMode && (
              <li>
                <Link href="/login" className="block py-3 text-sm font-medium">Login</Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
