"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Heart,
  LayoutDashboard,
  Users,
  Handshake,
  CalendarClock,
  ScrollText,
  Settings,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn, formatEnumLabel } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

const NAV = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/profiles", label: "Profiles", icon: Users },
  { href: "/admin/proposals", label: "Proposals", icon: Handshake },
  { href: "/admin/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavLinks = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted hover:bg-surface-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <Heart className="h-5 w-5 text-primary" fill="currentColor" />
          <span className="font-heading font-semibold">Life Partner Pro</span>
        </div>
        {NavLinks}
        <div className="border-t border-border p-3">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted">{formatEnumLabel(user.role)}</p>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 flex h-full w-64 flex-col bg-surface">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <span className="font-heading font-semibold">Life Partner Pro</span>
              <button onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {NavLinks}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
          <button className="text-muted md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <span className="hidden text-sm text-muted md:inline">Admin Dashboard</span>
          <div className="flex items-center gap-2">
            <button
              onClick={toggle}
              aria-label="Toggle dark mode"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/admin/login" })}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>
        <main className="flex-1 bg-background p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
