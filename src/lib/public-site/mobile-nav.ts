// The phone navigation for signed-in applicants. Pure data and rules so they can be tested.
export const APPLICANT_BOTTOM_NAV = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/dashboard/profile", label: "My Profile", icon: "profile" },
  { href: "/my-proposals", label: "Proposals", icon: "proposals" },
  { href: "/my-notifications", label: "Notifications", icon: "notifications" },
  { href: "/account-settings", label: "More", icon: "more" },
] as const;

// Shown on the signed-in account pages only. Not on the sign-in form (/my-status), the registration confirmation or the one-off request forms.
const SHOWN_UNDER = ["/dashboard", "/my-proposals", "/my-notifications", "/my-billing", "/my-cases", "/my-verification", "/my-privacy", "/account-settings"];

export function applicantBottomNavVisible(pathname: string | null): boolean {
  if (!pathname) return false;
  return SHOWN_UNDER.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
