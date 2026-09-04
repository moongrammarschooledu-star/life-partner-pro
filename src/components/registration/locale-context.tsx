"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { DICTIONARIES, type Locale, type StringKey } from "@/lib/i18n/registration-strings";

const STORAGE_KEY = "lpp_locale";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: StringKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function RegistrationLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "ur") setLocaleState(stored);
    } catch {
      // ignore — falls back to English
    }
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }

  function t(key: StringKey): string {
    return DICTIONARIES[locale][key] ?? DICTIONARIES.en[key];
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      <div dir={locale === "ur" ? "rtl" : "ltr"}>{children}</div>
    </LocaleContext.Provider>
  );
}

export function useRegistrationLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useRegistrationLocale must be used within RegistrationLocaleProvider");
  return ctx;
}

export function LocaleToggle() {
  const { locale, setLocale } = useRegistrationLocale();
  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "en" ? "ur" : "en")}
      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground"
    >
      <Languages className="h-3.5 w-3.5" />
      {locale === "en" ? "English | اردو" : "اردو | English"}
    </button>
  );
}
