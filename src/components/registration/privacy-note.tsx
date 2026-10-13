"use client";

import { Lock } from "lucide-react";
import { useRegistrationLocale } from "@/components/registration/locale-context";
import { cn } from "@/lib/utils";

// Short, plain statements shown where a step asks for something sensitive (STEP 35 §11). They describe how the platform really treats the
// information: not public, used only where authorised, shown only according to privacy permissions. English and Urdu, like the rest of the form.
const NOTES = {
  family: {
    en: "Family information helps with family-friendly matching where authorised. It is never shown publicly.",
    ur: "خاندانی معلومات مجاز صورتوں میں خاندانی مطابقت میں مدد دیتی ہیں۔ یہ عوامی طور پر کبھی نظر نہیں آتیں۔",
  },
  income: {
    en: "Income is optional. It is used only where authorised and is shown only according to privacy permissions.",
    ur: "آمدنی اختیاری ہے۔ یہ صرف مجاز صورتوں میں استعمال ہوتی ہے اور صرف پرائیویسی کی اجازتوں کے مطابق دکھائی جاتی ہے۔",
  },
  photo: {
    en: "Your photo is private. It is shown only to people the platform's privacy rules allow, never publicly.",
    ur: "آپ کی تصویر نجی ہے۔ یہ صرف ان لوگوں کو دکھائی جاتی ہے جنہیں پلیٹ فارم کے پرائیویسی قواعد اجازت دیتے ہیں، عوامی طور پر کبھی نہیں۔",
  },
  intro: {
    en: "Your personal information is not publicly displayed. Each step asks only for what it needs, and optional details are marked as optional.",
    ur: "آپ کی ذاتی معلومات عوامی طور پر ظاہر نہیں کی جاتیں۔ ہر مرحلہ صرف ضروری معلومات مانگتا ہے، اور اختیاری تفصیلات پر اختیاری لکھا ہوتا ہے۔",
  },
} as const;

export type PrivacyNoteKind = keyof typeof NOTES;

export function PrivacyNote({ kind, className }: { kind: PrivacyNoteKind; className?: string }) {
  const { locale } = useRegistrationLocale();
  return (
    <p className={cn("flex items-start gap-2 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted", className)}>
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span>{NOTES[kind][locale]}</span>
    </p>
  );
}
