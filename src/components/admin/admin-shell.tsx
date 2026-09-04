"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  ShieldCheck,
  Sparkles,
  Handshake,
  CalendarClock,
  CalendarDays,
  ScrollText,
  History,
  Settings,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
  BarChart3,
  UserCog,
  Inbox,
} from "lucide-react";
import { cn, formatEnumLabel } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { hasPermission, type Permission, type AdminRole } from "@/lib/permissions";
import { GlobalSearch } from "@/components/admin/global-search";
import { NotificationsPanel } from "@/components/admin/notifications-panel";

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; permission?: Permission }[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/profiles?status=NEW", label: "New Profiles", icon: UserPlus },
  { href: "/admin/profiles", label: "All Profiles", icon: Users },
  { href: "/admin/profiles?verified=true", label: "Verified Profiles", icon: ShieldCheck },
  { href: "/admin/matching", label: "Matching Center", icon: Sparkles, permission: "match:run" },
  { href: "/admin/matches", label: "Match History", icon: History, permission: "match:run" },
  { href: "/admin/proposals", label: "Proposals", icon: Handshake, permission: "proposal:create" },
  { href: "/admin/meetings", label: "Meetings", icon: CalendarDays, permission: "proposal:create" },
  { href: "/admin/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/support", label: "Support", icon: Inbox },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, permission: "audit:view" },
  { href: "/admin/settings", label: "Settings", icon: Settings, permission: "settings:edit" },
];

const SUPER_ADMIN_NAV = [{ href: "/admin/admin-users", label: "Admin Users", icon: UserCog }];

export function AdminShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { theme, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = user.role as AdminRole;

  const navItems = [
    ...NAV.filter((item) => !item.permission || hasPermission(role, item.permission)),
    ...(role === "SUPER_ADMIN" ? SUPER_ADMIN_NAV : []),
  ];

  const NavLinks = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {navItems.map((item) => {
        const [basePath, query] = item.href.split("?");
        let active: boolean;
        if (query) {
          active = pathname === basePath && searchParams.toString() === query;
        } else if (basePath === "/admin/profiles") {
          // "All Profiles" — active on the bare list (no filter) or any profile detail subpage.
          active = pathname === basePath ? searchParams.toString() === "" : pathname.startsWith(`${basePath}/`);
        } else {
          active = pathname === basePath || pathname.startsWith(`${basePath}/`);
        }
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
          <Image src="/logo-icon.png" alt="Life Partner Pro" width={28} height={28} className="h-7 w-7" priority />
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
              <div className="flex items-center gap-2">
                <Image src="/logo-icon.png" alt="Life Partner Pro" width={24} height={24} className="h-6 w-6" />
                <span className="font-heading font-semibold">Life Partner Pro</span>
              </div>
              <button onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            {NavLinks}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <button className="text-muted md:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden min-w-0 flex-1 md:block md:max-w-md">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-2">
            <NotificationsPanel />
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
        <div className="border-b border-border bg-surface px-4 py-2 md:hidden">
          <GlobalSearch />
        </div>
        <main className="flex-1 bg-background p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
