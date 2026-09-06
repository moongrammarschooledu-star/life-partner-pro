import { Loader2, AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

// Shared loading/error/empty wrapper for every Reports tab (spec §34 — "Not
// enough data available" rather than a misleading render).
export function SectionShell({
  loading,
  error,
  isEmpty,
  children,
}: {
  loading: boolean;
  error: boolean;
  isEmpty?: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }
  if (error) {
    return <EmptyState icon={AlertTriangle} title="Could not load this report" description="Please try again." />;
  }
  if (isEmpty) {
    return <EmptyState title="Not enough data available for this report." />;
  }
  return <>{children}</>;
}
