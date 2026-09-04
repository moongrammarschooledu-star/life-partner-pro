"use client";

import Link from "next/link";
import Image from "next/image";
import { Moon, Sun, ShieldCheck } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { buttonClass } from "@/components/ui/button";

export function PublicNavbar() {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo-icon.png" alt="Life Partner Pro" width={32} height={32} className="h-8 w-8" priority />
          <span className="font-heading text-lg font-semibold">Life Partner Pro</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium sm:flex">
          <Link href="/how-it-works" className="text-muted hover:text-foreground">
            How It Works
          </Link>
          <Link href="/#why-us" className="text-muted hover:text-foreground">
            Why Life Partner Pro
          </Link>
          <Link href="/support" className="text-muted hover:text-foreground">
            Support
          </Link>
          <Link href="/admin/login" className="flex items-center gap-1 text-muted hover:text-foreground">
            <ShieldCheck className="h-4 w-4" /> Admin
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link href="/register" className={buttonClass({ size: "sm" })}>
            Register Your Profile
          </Link>
        </div>
      </div>
    </header>
  );
}
