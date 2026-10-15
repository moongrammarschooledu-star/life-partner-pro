"use client";

import { Field, Input, Select, Checkbox, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";
import { OptionalSection } from "@/components/registration/steps/optional-section";

const LANGUAGE_OPTIONS = ["Urdu", "English", "Punjabi", "Arabic"];
// Drop-downs, not free text: matching compares these values, so "islam", "Islam " and "Muslim" must not be three different religions.
const RELIGIONS = ["Islam", "Christianity", "Hinduism", "Sikhism", "Other"];
const SECTS = ["Sunni", "Shia", "Other"];

function ChoiceSelect({ id, value, options, placeholder, onChange }: { id: string; value: string; options: string[]; placeholder: string; onChange: (v: string) => void }) {
  // A value saved earlier (a profile typed before these lists existed) stays selectable instead of silently disappearing.
  const custom = value && !options.includes(value) ? value : null;
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {custom && <option value={custom}>{custom}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Select>
  );
}
const PERSONALITY_OPTIONS = ["Calm", "Friendly", "Responsible", "Family Oriented", "Ambitious", "Caring", "Social", "Reserved", "Practical"];

function MultiCheckboxGroup({
  options,
  value,
  onChange,
  allowCustom,
}: {
  options: string[];
  value: string; // comma-separated
  onChange: (v: string) => void;
  allowCustom?: boolean;
}) {
  const selected = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const custom = selected.filter((s) => !options.includes(s)).join(", ");

  function toggle(option: string) {
    const next = selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option];
    onChange(next.join(", "));
  }

  function setCustom(text: string) {
    const known = selected.filter((s) => options.includes(s));
    const customItems = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange([...known, ...customItems].join(", "));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <Checkbox key={option} label={option} checked={selected.includes(option)} onChange={() => toggle(option)} />
        ))}
      </div>
      {allowCustom && (
        <Input placeholder="Other (comma-separated)" value={custom} onChange={(e) => setCustom(e.target.value)} />
      )}
    </div>
  );
}

export function StepLifestyle({
  data,
  errors,
  onChange,
  hideReligious,
}: {
  data: WizardData["lifestyle"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["lifestyle"]>(field: K, value: WizardData["lifestyle"][K]) => void;
  // Admin edit form only — same reasoning as StepEducationProfession's
  // hideIncome: an admin without sensitive:family:view never sees
  // religion/sect/religiousPractice, so the fields are omitted rather than
  // shown blank and then submitted as a silent clear.
  hideReligious?: boolean;
}) {
  const { t } = useRegistrationLocale();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("requiredHint")}</p>
      {!hideReligious && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t("religion")} *`} error={errors.religion} htmlFor="religion">
            <ChoiceSelect id="religion" value={data.religion} options={RELIGIONS} placeholder={t("selectReligion")} onChange={(v) => onChange("religion", v)} />
          </Field>
          {(/islam|muslim/i.test(data.religion) || data.sect) && (
            <Field label={/islam|muslim/i.test(data.religion) ? `${t("sect")} *` : t("sect")} error={errors.sect} htmlFor="sect">
              <ChoiceSelect id="sect" value={data.sect} options={SECTS} placeholder={t("selectSect")} onChange={(v) => onChange("sect", v)} />
            </Field>
          )}
        </div>
      )}

      <Field label={t("languages")} htmlFor="languages">
        <MultiCheckboxGroup options={LANGUAGE_OPTIONS} value={data.languages} onChange={(v) => onChange("languages", v)} allowCustom />
      </Field>

      <OptionalSection>
        <div className="space-y-4">
          {!hideReligious && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("religiousPractice")} htmlFor="religiousPractice">
                <Input id="religiousPractice" value={data.religiousPractice} onChange={(e) => onChange("religiousPractice", e.target.value)} placeholder="e.g. Practicing" />
              </Field>
            </div>
          )}
          <div className="flex gap-6">
            <Field label={t("smoking")} htmlFor="smoking">
              <Checkbox label={t("yes")} checked={data.smoking} onChange={(e) => onChange("smoking", e.target.checked)} />
            </Field>
            <Field label={t("drinking")} htmlFor="drinking">
              <Checkbox label={t("yes")} checked={data.drinking} onChange={(e) => onChange("drinking", e.target.checked)} />
            </Field>
          </div>

          <Field label={t("hobbies")} htmlFor="hobbies">
            <Textarea
              id="hobbies"
              value={data.hobbies}
              onChange={(e) => onChange("hobbies", e.target.value)}
              placeholder="e.g. Reading, Travel, Cooking"
              rows={2}
            />
          </Field>

          <Field label={t("personality")} htmlFor="personality">
            <MultiCheckboxGroup options={PERSONALITY_OPTIONS} value={data.personality} onChange={(v) => onChange("personality", v)} allowCustom />
          </Field>

          <Field label={t("aboutMe")} htmlFor="aboutMe">
            <Textarea id="aboutMe" value={data.aboutMe} onChange={(e) => onChange("aboutMe", e.target.value)} placeholder={t("aboutMePlaceholder")} rows={4} />
          </Field>

          <Field label="Other Lifestyle Preferences" htmlFor="otherPreferences">
            <Textarea id="otherPreferences" value={data.otherPreferences} onChange={(e) => onChange("otherPreferences", e.target.value)} />
          </Field>
        </div>
      </OptionalSection>
    </div>
  );
}
