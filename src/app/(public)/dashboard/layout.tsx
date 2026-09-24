"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, UserCircle, Heart, Users, Activity, Sparkles } from "lucide-react";
import { ApplicantGate } from "@/components/public/applicant-gate";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/profile", label: "My Profile", icon: UserCircle },
  { href: "/dashboard/family", label: "Family Interaction", icon: Users },
  { href: "/dashboard/activity", label: "Activity Timeline", icon: Activity },
  { href: "/dashboard/ai-assistant", label: "Profile Assistant", icon: Sparkles },
];

// STEP 21 — local layout for the new applicant dashboard hub. Wraps only the
// genuinely new /dashboard/* pages in a shared sign-in gate + side nav;
// every pre-existing /my-* page keeps its own independent structure
// unchanged (Decision 1 — additive, not a retrofit).
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <ApplicantGate title="My Dashboard" description="Enter your Profile ID and the email you registered with to continue.">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {NAV.map((item) => {
              const active = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
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
          </nav>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ApplicantGate>
  );
}
