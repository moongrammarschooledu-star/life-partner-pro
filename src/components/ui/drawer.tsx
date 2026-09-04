"use client";

import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// A full-height slide-over from the right on desktop, full-screen on mobile —
// used where a Modal is too small (the Matching Center's match detail view
// needs room for a breakdown, mutual scores, and a proposal form at once).
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-surface shadow-xl sm:max-w-2xl",
          className
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          <button onClick={onClose} className="ml-auto text-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="sticky bottom-0 border-t border-border bg-surface px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}
