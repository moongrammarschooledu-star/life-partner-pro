"use client";

import { useState } from "react";
import { Select } from "@/components/ui/form";
import { useRegistrationLocale } from "@/components/registration/locale-context";
import { MONTHS, dobYears, joinDob, splitDob, type DobParts } from "@/lib/dob-parts";

// Day / month / year dropdowns. `value` is the ISO date the form stores ("" until all three are chosen). While only some parts are chosen they are kept here, so
// picking the year first or the day last does not lose anything; the form value is set only once the date is complete and real.
export function DobSelect({ id, value, onChange, error }: { id?: string; value: string; onChange: (iso: string) => void; error?: boolean }) {
  const { t } = useRegistrationLocale();
  const [partial, setPartial] = useState<Partial<DobParts>>({});
  const parts: Partial<DobParts> = splitDob(value) ?? partial;
  const years = dobYears();
  const customYear = parts.y && !years.includes(Number(parts.y)) ? parts.y : null; // a saved draft may hold a year outside the list

  function pick(field: keyof DobParts, v: string) {
    const next = { ...parts, [field]: v };
    const iso = joinDob(next);
    setPartial(next);
    onChange(iso);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <Select id={id} aria-label={t("day")} aria-invalid={error} value={parts.d ?? ""} onChange={(e) => pick("d", e.target.value)}>
        <option value="">{t("day")}</option>
        {Array.from({ length: 31 }, (_, i) => (
          <option key={i + 1} value={String(i + 1)}>
            {i + 1}
          </option>
        ))}
      </Select>
      <Select aria-label={t("month")} aria-invalid={error} value={parts.m ?? ""} onChange={(e) => pick("m", e.target.value)}>
        <option value="">{t("month")}</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={String(i + 1)}>
            {name}
          </option>
        ))}
      </Select>
      <Select aria-label={t("year")} aria-invalid={error} value={parts.y ?? ""} onChange={(e) => pick("y", e.target.value)}>
        <option value="">{t("year")}</option>
        {customYear && <option value={customYear}>{customYear}</option>}
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </Select>
    </div>
  );
}
