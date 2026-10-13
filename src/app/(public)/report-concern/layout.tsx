import { pageMetadata } from "@/lib/public-site/seo";

// The page itself is a client component, so its (noindex) metadata lives here.
export const metadata = pageMetadata("/report-concern");

export default function ReportConcernLayout({ children }: { children: React.ReactNode }) {
  return children;
}
