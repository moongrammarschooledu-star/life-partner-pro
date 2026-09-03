import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  label: string;
  description?: string;
  date: Date | string;
  active?: boolean;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative border-l border-border ml-2">
      {items.map((item) => (
        <li key={item.id} className="mb-6 ml-4 last:mb-0">
          <span
            className={cn(
              "absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface",
              item.active ? "bg-primary" : "bg-border"
            )}
          />
          <p className="text-sm font-medium text-foreground">{item.label}</p>
          {item.description && <p className="text-xs text-muted mt-0.5">{item.description}</p>}
          <time className="text-xs text-muted">{formatDateTime(item.date)}</time>
        </li>
      ))}
    </ol>
  );
}
