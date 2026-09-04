import Link from "next/link";
import Image from "next/image";

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row">
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo-icon.png" alt="Life Partner Pro" width={28} height={28} className="h-7 w-7" />
              <span className="font-heading text-base font-semibold">Life Partner Pro</span>
            </div>
            <p className="mt-2 max-w-xs text-sm text-muted">Finding the Right Life Partner, With Trust.</p>
          </div>
          <div className="flex gap-8 text-sm">
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">Platform</span>
              <Link href="/register" className="text-muted hover:text-foreground">Register</Link>
              <Link href="/how-it-works" className="text-muted hover:text-foreground">How It Works</Link>
              <Link href="/update-request" className="text-muted hover:text-foreground">Update My Profile</Link>
              <Link href="/support" className="text-muted hover:text-foreground">Support</Link>
              <Link href="/admin/login" className="text-muted hover:text-foreground">Admin Login</Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-medium text-foreground">Legal</span>
              <Link href="/privacy-policy" className="text-muted hover:text-foreground">Privacy Policy</Link>
              <Link href="/terms" className="text-muted hover:text-foreground">Terms &amp; Conditions</Link>
            </div>
          </div>
        </div>
        <p className="mt-8 text-xs text-muted">
          &copy; {new Date().getFullYear()} Life Partner Pro. Your information is stored securely and reviewed only by
          authorized administrators for matchmaking purposes.
        </p>
      </div>
    </footer>
  );
}
