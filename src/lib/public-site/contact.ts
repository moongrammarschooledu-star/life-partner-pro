import { z } from "zod";

// The public contact / support form. One schema shared by the form and the API, so the browser and the server agree on every limit.
export const CONTACT_CATEGORIES = [
  { value: "GENERAL", label: "General enquiry" },
  { value: "TECHNICAL", label: "Technical support" },
  { value: "PRIVACY", label: "Privacy request or question" },
  { value: "ACCOUNT", label: "Account or sign-in help" },
  { value: "MEMBERSHIP", label: "Membership or payment" },
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number]["value"];

export const CONTACT_LIMITS = { email: 254, profileCode: 32, subject: 150, message: 4000, minMessage: 10 } as const;

// Links in a contact message are a common spam / phishing vector and this form needs none.
const LINK_PATTERN = /(https?:\/\/|www\.)/i;

export const contactSchema = z.object({
  category: z.enum(CONTACT_CATEGORIES.map((c) => c.value) as [ContactCategory, ...ContactCategory[]]).default("GENERAL"),
  profileCode: z
    .string()
    .trim()
    .max(CONTACT_LIMITS.profileCode)
    .regex(/^[A-Za-z0-9-]*$/, "Profile ID may contain only letters, digits and hyphens")
    .optional()
    .transform((v) => (v ? v : undefined)),
  email: z.string().trim().toLowerCase().max(CONTACT_LIMITS.email).email("Enter a valid e-mail address"),
  subject: z.string().trim().min(3, "Enter a subject").max(CONTACT_LIMITS.subject),
  message: z
    .string()
    .trim()
    .min(CONTACT_LIMITS.minMessage, "Please write a little more")
    .max(CONTACT_LIMITS.message)
    .refine((m) => !LINK_PATTERN.test(m), "Please remove web links from your message"),
  consent: z.literal(true, { error: "Please agree so we can reply to you" }),
  // Honeypot: visually hidden, a person never fills it. Any value means a bot.
  website: z.string().max(0).optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
