"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, UserCircle, Heart, CalendarDays, ShieldCheck, Lock, LogOut } from "lucide-react";
import { FamilyGate } from "@/components/family/family-gate";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/family/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/family/applicant", label: "Applicant Profile", icon: UserCircle },
  { href: "/family/proposals", label: "Proposals", icon: Heart },
  { href: "/family/meetings", label: "Meetings", icon: CalendarDays },
  { href: "/family/consent", label: "Consent & Access", icon: ShieldCheck },
  { href: "/family/security", label: "Security", icon: Lock },
];

// A genuinely separate top-level route group (not nested under the
// applicant dashboard's layout) since the session/cookie/identity here is
// different — see src/lib/family/family-session.ts.
export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/family/logout", { method: "POST" });
    router.push("/family/dashboard");
    router.refresh();
  }

  return (
    <FamilyGate>
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <p className="mb-3 font-heading text-lg font-semibold">Family Portal</p>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname?.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
                    active ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
            <button onClick={logout} className="mt-2 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-muted hover:bg-surface-muted hover:text-foreground">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </nav>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </FamilyGate>
  );
}
