import Link from "next/link";

// Minimal public shell for marketing landing pages: no applicant navigation, no notification bell, no admin link —
// a landing page is an entry point, not part of the signed-in product.
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted">
        <span>Life Partner Pro — private matrimonial matchmaking · </span>
        <Link href="/privacy-policy" className="underline">Privacy policy</Link>
        <span> · </span>
        <Link href="/terms" className="underline">Terms</Link>
      </footer>
    </>
  );
}
