"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, UserRound, Mail, Bell, Menu } from "lucide-react";
import { applicantBottomNavVisible, APPLICANT_BOTTOM_NAV } from "@/lib/public-site/mobile-nav";
import { cn } from "@/lib/utils";

const ICONS = { home: Home, profile: UserRound, proposals: Mail, notifications: Bell, more: Menu } as const;

// Phone navigation for a signed-in applicant (STEP 35 §33): Home, My Profile, Proposals, Notifications and More (account, privacy and settings,
// so privacy controls are one tap away). No swiping, public likes, followers or open messaging. There is no separate Meetings tab because
// the platform has no applicant meetings page: meetings are shown with the proposal they belong to.
export function ApplicantBottomNav() {
  const pathname = usePathname();
  if (!applicantBottomNavVisible(pathname)) return null;
  return (
    <>
      <div className="h-16 lg:hidden" aria-hidden="true" />
      <nav aria-label="Applicant" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {APPLICANT_BOTTOM_NAV.map((item) => {
            const Icon = ICONS[item.icon];
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-xs", active ? "font-semibold text-primary" : "text-muted")}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
