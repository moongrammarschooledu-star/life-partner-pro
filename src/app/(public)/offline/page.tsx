import Link from "next/link";
import { WifiOff } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { pageMetadata } from "@/lib/public-site/seo";

export const metadata = pageMetadata("/offline");

// Shown by the service worker when the network is unavailable. Static and generic on purpose: it never contains personal data,
// and no signed-in page is ever stored for offline use.
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <WifiOff className="h-10 w-10 text-primary" aria-hidden="true" />
      <h1 className="font-heading text-2xl font-semibold">You are offline</h1>
      <p className="text-sm text-muted">Life Partner Pro needs an internet connection to open your profile and proposals. Your private information is never stored on this device for offline use. Please reconnect and try again.</p>
      <Link href="/" className={buttonClass({})}>Try again</Link>
    </div>
  );
}
