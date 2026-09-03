import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

export function EmptyState({ icon: Icon = Inbox, title, description }: { icon?: LucideIcon; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Icon className="h-10 w-10 text-muted" />
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="text-sm text-muted max-w-sm">{description}</p>}
    </div>
  );
}
