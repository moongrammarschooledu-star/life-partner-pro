"use client";

import { Select } from "@/components/ui/form";
import { useRegistrationLocale } from "@/components/registration/locale-context";

// One dropdown instead of a cm/ft-in toggle with free typing: most people know
// their height in feet and inches, and typing partial numbers into two linked
// inputs kept rewriting itself. The stored value is still centimetres, so the
// API, database and matching are unchanged.
const MIN_INCHES = 54; // 4'6"
const MAX_INCHES = 80; // 6'8"

const HEIGHT_OPTIONS = Array.from({ length: MAX_INCHES - MIN_INCHES + 1 }, (_, i) => {
  const totalInches = MIN_INCHES + i;
  const cm = Math.round(totalInches * 2.54);
  return { cm: String(cm), label: `${Math.floor(totalInches / 12)}'${totalInches % 12}"` };
});

export function HeightSelect({ id, value, onChange }: { id?: string; value: string; onChange: (cm: string) => void }) {
  const { t } = useRegistrationLocale();
  // A draft saved by the old form may hold a height that is not on the list.
  const custom = value && !HEIGHT_OPTIONS.some((o) => o.cm === value) ? value : null;
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("selectHeight")}</option>
      {custom && <option value={custom}>{custom} cm</option>}
      {HEIGHT_OPTIONS.map((o) => (
        <option key={o.cm} value={o.cm}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
