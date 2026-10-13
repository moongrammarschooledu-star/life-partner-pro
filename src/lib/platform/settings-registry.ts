import type { ValueSpec } from "@/lib/platform/config-values";

// Registry of the platform settings the control center manages (STEP 36 §4, §43, §44). Only settings with a stated effect are registered. Where a
// setting is applied by the application, `appliedBy` says where; where it is recorded as the official value without a consumer yet, `appliedBy` is empty and the screen says so.
//
// Deliberately NOT here: matching, verification, proposal, payment, security, privacy, retention, risk, AI and workflow settings. Each has its own editor,
// validation and approvals (STEP 6–34); the control center links to them instead of holding a second copy.

export type SettingCategory = "identity" | "localization" | "contact" | "branding" | "status";
export type SettingRisk = "LOW" | "HIGH";

export interface SettingDef extends ValueSpec {
  key: string;
  label: string;
  description: string;
  category: SettingCategory;
  default: unknown;
  risk: SettingRisk;
  /** Where the application uses the value. Empty = recorded as the official value; no screen reads it yet. */
  appliedBy: string[];
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const PHONE = /^[+0-9][0-9 ()-]{5,29}$/;

export const SETTING_DEFS: SettingDef[] = [
  { key: "platform.name", label: "Platform name", description: "The official name of the platform.", category: "identity", type: "STRING", maxLength: 80, default: "Life Partner Pro", risk: "LOW", appliedBy: ["Status page"] },
  { key: "platform.short_name", label: "Short name", description: "A short form used where space is tight.", category: "identity", type: "STRING", maxLength: 30, default: "Life Partner Pro", risk: "LOW", appliedBy: [] },
  { key: "platform.tagline", label: "Tagline", description: "The one-line promise under the name.", category: "identity", type: "STRING", maxLength: 120, default: "Finding the Right Life Partner, With Trust.", risk: "LOW", appliedBy: ["Status page"] },
  { key: "platform.description", label: "Description", description: "A short description of the platform.", category: "identity", type: "STRING", maxLength: 300, default: "A private, structured and family-friendly matrimonial platform.", risk: "LOW", appliedBy: [] },

  { key: "localization.default_language", label: "Default language", description: "The language used when a person has not chosen one.", category: "localization", type: "ENUM", enumValues: ["en", "ur"], default: "en", risk: "LOW", appliedBy: [] },
  { key: "localization.enabled_languages", label: "Enabled languages", description: "Languages the platform offers. Architecture allows more; only English and Urdu have translations today.", category: "localization", type: "JSON", maxLength: 100, default: ["en", "ur"], risk: "LOW", appliedBy: [] },
  { key: "localization.default_country", label: "Default country", description: "The country assumed for new records when none is given.", category: "localization", type: "STRING", maxLength: 60, default: "Pakistan", risk: "LOW", appliedBy: [] },
  { key: "localization.default_currency", label: "Default currency display", description: "Three-letter currency code used for display where a price carries none. Prices themselves are controlled in the membership system.", category: "localization", type: "STRING", maxLength: 3, pattern: /^[A-Z]{3}$/, patternMessage: "Use a three-letter code such as PKR.", default: "PKR", risk: "LOW", appliedBy: [] },
  { key: "localization.timezone", label: "Time zone", description: "The time zone shown on the status page and used for platform-level schedules.", category: "localization", type: "STRING", maxLength: 60, pattern: /^[A-Za-z_]+(?:\/[A-Za-z_+-]+){0,2}$/, patternMessage: "Use an IANA name such as Asia/Karachi.", default: "Asia/Karachi", risk: "LOW", appliedBy: ["Status page"] },
  { key: "localization.date_format", label: "Date format", description: "How dates are written.", category: "localization", type: "ENUM", enumValues: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"], default: "DD/MM/YYYY", risk: "LOW", appliedBy: [] },
  { key: "localization.time_format", label: "Time format", description: "12-hour or 24-hour clock.", category: "localization", type: "ENUM", enumValues: ["12h", "24h"], default: "12h", risk: "LOW", appliedBy: [] },

  { key: "contact.public_email", label: "Public e-mail address", description: "Shown on the Contact page and the status page. Leave empty to show none.", category: "contact", type: "STRING", allowEmpty: true, maxLength: 200, pattern: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, patternMessage: "Enter a valid e-mail address.", default: "", risk: "LOW", appliedBy: ["Contact page", "Status page"] },
  { key: "contact.public_phone", label: "Public phone number", description: "Shown on the Contact page. Leave empty to show none.", category: "contact", type: "STRING", allowEmpty: true, maxLength: 30, pattern: PHONE, patternMessage: "Enter a phone number with digits, spaces, + ( ) or -.", default: "", risk: "LOW", appliedBy: ["Contact page"] },
  { key: "contact.public_whatsapp", label: "Public WhatsApp number", description: "Shown on the Contact page. Leave empty to show none.", category: "contact", type: "STRING", allowEmpty: true, maxLength: 30, pattern: PHONE, patternMessage: "Enter a phone number with digits, spaces, + ( ) or -.", default: "", risk: "LOW", appliedBy: ["Contact page"] },
  { key: "contact.public_address", label: "Public address", description: "Shown on the Contact page. Leave empty to show none.", category: "contact", type: "STRING", allowEmpty: true, maxLength: 250, default: "", risk: "LOW", appliedBy: ["Contact page"] },
  { key: "contact.support_hours", label: "Support hours", description: "For example “Monday to Saturday, 10:00 to 18:00”. Shown on the Contact page. Leave empty to show none.", category: "contact", type: "STRING", allowEmpty: true, maxLength: 120, default: "", risk: "LOW", appliedBy: ["Contact page", "Status page"] },

  { key: "branding.primary_colour", label: "Primary colour", description: "The main brand colour (recorded as the official value).", category: "branding", type: "STRING", maxLength: 7, pattern: HEX_COLOUR, patternMessage: "Use a colour like #7a0f31.", default: "#7a0f31", risk: "LOW", appliedBy: [] },
  { key: "branding.email_footer_text", label: "E-mail footer text", description: "Closing line for system e-mails.", category: "branding", type: "STRING", allowEmpty: true, maxLength: 300, default: "", risk: "LOW", appliedBy: [] },
  { key: "branding.website_url", label: "Website address", description: "The public website address (https).", category: "branding", type: "URL", allowEmpty: true, default: "", risk: "LOW", appliedBy: [] },

  { key: "status.page_enabled", label: "Public status page", description: "Turn the public status page (/status) on or off.", category: "status", type: "BOOLEAN", default: true, risk: "LOW", appliedBy: ["Status page"] },
  { key: "status.public_message", label: "Status page message", description: "A short note shown at the top of the status page. Leave empty for none.", category: "status", type: "STRING", allowEmpty: true, maxLength: 300, default: "", risk: "LOW", appliedBy: ["Status page"] },
];

export function findSettingDef(key: string): SettingDef | undefined {
  return SETTING_DEFS.find((d) => d.key === key);
}

/** Which permission changes a setting: branding and contact have their own, the rest need the settings permission. */
export function permissionForSetting(def: SettingDef): "platform:settings:manage" | "platform:branding:manage" {
  return def.category === "branding" || def.category === "contact" ? "platform:branding:manage" : "platform:settings:manage";
}

export function settingDefaults(): Record<string, unknown> {
  return Object.fromEntries(SETTING_DEFS.map((d) => [d.key, d.default]));
}
