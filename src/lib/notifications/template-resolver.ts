import { prisma } from "@/lib/prisma";
import type { NotificationChannel, NotificationType, Locale } from "@prisma/client";
import { DEFAULT_TEMPLATES } from "@/lib/notifications/default-templates";

// Variables safe enough to ever appear in a notification — spec §19 "do not
// allow arbitrary sensitive variables". Never a name, city, income, or any
// other profile detail (spec §33).
export const SAFE_VARIABLES = ["profile_id", "proposal_id", "meeting_date", "meeting_time"] as const;

export interface ResolvedTemplate {
  title: string;
  body: string;
  subject?: string;
}

// Pure — unknown/non-allow-listed {{variables}} are dropped, never leaked
// verbatim (spec §19's allow-list requirement).
export function substituteVariables(text: string, vars: Record<string, string>, allowList: readonly string[]): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!allowList.includes(name)) return "";
    return vars[name] ?? "";
  });
}

// Pure — English fallback when a language's dictionary entry is missing (spec §20).
export function pickLocaleCopy<T>(dict: Record<Locale, T>, language: Locale): T {
  return dict[language] ?? dict.EN;
}

// DB override -> built-in default dictionary -> English fallback.
export async function resolveTemplate(
  event: NotificationType,
  channel: NotificationChannel,
  language: Locale,
  vars: Record<string, string> = {}
): Promise<ResolvedTemplate> {
  const override = await prisma.notificationTemplate.findUnique({
    where: { event_channel_language: { event, channel, language } },
  });

  if (override && override.status === "ACTIVE") {
    const allowList = Array.isArray(override.variables) ? (override.variables as string[]) : [];
    return {
      title: override.name,
      body: substituteVariables(override.message, vars, allowList),
      subject: override.subject ? substituteVariables(override.subject, vars, allowList) : undefined,
    };
  }

  const copy = pickLocaleCopy(DEFAULT_TEMPLATES[event], language);
  return {
    title: copy.title,
    body: substituteVariables(copy.body, vars, SAFE_VARIABLES),
    subject: copy.subject ? substituteVariables(copy.subject, vars, SAFE_VARIABLES) : undefined,
  };
}
