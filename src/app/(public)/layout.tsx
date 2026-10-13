import { PublicNavbar } from "@/components/public/navbar";
import { PublicFooter } from "@/components/public/footer";
import { InstallPrompt } from "@/components/public/install-prompt";
import { PublicTracker } from "@/components/public/public-tracker";
import { ApplicantBottomNav } from "@/components/public/applicant-bottom-nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>
      <PublicNavbar />
      <main id="main-content" className="flex-1">{children}</main>
      <PublicFooter />
      <InstallPrompt />
      <PublicTracker />
      <ApplicantBottomNav />
    </>
  );
}
