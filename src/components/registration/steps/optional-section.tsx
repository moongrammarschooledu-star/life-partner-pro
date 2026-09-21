"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useRegistrationLocale } from "@/components/registration/locale-context";

// Collapsed by default so a step shows only what is needed; everything inside
// stays part of the same form state, so nothing is lost when it is skipped.
export function OptionalSection({ children }: { children: ReactNode }) {
  const { t } = useRegistrationLocale();
  return (
    <details className="group rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium">
        <span>
          {t("optionalDetails")} <span className="font-normal text-muted">— {t("optionalDetailsHint")}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
