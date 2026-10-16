import type { ProfileDetailView } from "@/lib/profile-pdf";
import { profileSections } from "@/lib/profile-pdf";
import { formatEnumLabel } from "@/lib/utils";

// What the reviewer needs to SEE next to each checklist item so that checking it is a glance and a tick: the value the person entered (name, date of birth, city,
// education...), or for the contact items whether the person has confirmed that number / address. Only what the reviewing admin may see is shown (toDetailDto has already
// removed income, family and religion for admins without that access), and the contact numbers themselves are never part of this: they stay behind the audited reveal.

export interface ChecklistValueContext {
  phoneVerifiedAt: Date | null;
  emailVerifiedAt: Date | null;
  whatsappVerifiedAt: Date | null;
  hasWhatsapp: boolean;
  hasEmail: boolean;
  photoCount: number;
}

const present = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";
const lines = (entries: Array<[string, unknown]>): string | null => {
  const out = entries.filter(([, v]) => present(v)).map(([l, v]) => `${l}: ${String(v)}`);
  return out.length > 0 ? out.join("\n") : null;
};
const day = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

export function checklistValues(p: ProfileDetailView, ctx: ChecklistValueContext): Record<string, string | null> {
  const partner = profileSections(p).find((s) => s.title === "Partner requirements");
  const hidden = "Hidden: you do not have permission to see this.";
  const confirmed = (at: Date | null, what: string) => (at ? `The person confirmed the ${what} on ${day(at)}.` : `The person has not confirmed the ${what} yet.`);
  const photos = ctx.photoCount > 0 ? "The photo is shown above." : "No photo has been uploaded.";

  return {
    name_reviewed: p.fullName,
    dob_reviewed: `${day(p.dateOfBirth)} (${p.age} years)`,
    gender_confirmed: formatEnumLabel(p.gender),
    marital_status_reviewed: [formatEnumLabel(p.maritalStatus), p.hasChildren ? `with children${p.numberOfChildren ? ` (${p.numberOfChildren})` : ""}` : ""].filter(Boolean).join(", "),
    city_area_reviewed: [p.city, p.area, p.country].filter(present).join(", "),

    mobile_verified: confirmed(ctx.phoneVerifiedAt, "mobile number"),
    whatsapp_verified: ctx.hasWhatsapp ? confirmed(ctx.whatsappVerifiedAt, "WhatsApp number") : "No separate WhatsApp number was given (the mobile number is used).",
    email_verified: ctx.hasEmail ? confirmed(ctx.emailVerifiedAt, "e-mail address") : "No e-mail address was given (nothing to confirm).",

    education_reviewed: lines([["Level", p.education?.level], ["Degree", p.education?.degree], ["Institution", p.education?.institution]]) ?? "Nothing entered.",
    profession_reviewed: lines([["Profession", p.profession?.profession], ["Job title", p.profession?.jobTitle]]) ?? "Nothing entered.",
    employment_reviewed:
      lines([
        ["Type", p.profession ? formatEnumLabel(p.profession.employmentType) : ""],
        ["Company", p.profession?.companyName],
        ["Work location", p.profession?.workLocation],
        ["Business details", p.profession?.businessDetails],
        ["Monthly income", p.profession?.monthlyIncome],
        ["Annual income", p.profession?.annualIncome],
      ]) ?? "Nothing entered.",
    family_reviewed: p.family
      ? lines([
          ["Father", p.family.fatherOccupation],
          ["Mother", p.family.motherOccupation],
          ["Brothers / sisters", `${p.family.numberOfBrothers} / ${p.family.numberOfSisters}`],
          ["Family type", formatEnumLabel(p.family.familyType)],
          ["Family status", formatEnumLabel(p.family.familyStatus)],
          ["Location", p.family.familyLocation],
          ["Background", p.family.familyBackground],
        ]) ?? "Nothing entered."
      : hidden,
    partner_requirements_reviewed: partner ? partner.rows.map(([l, v]) => `${l}: ${v}`).join("\n") : "Nothing entered.",

    photo_uploaded: ctx.photoCount > 0 ? `${ctx.photoCount} photo${ctx.photoCount === 1 ? "" : "s"} uploaded.` : "No photo has been uploaded.",
    photo_quality_acceptable: photos,
    photo_belongs_to_applicant: photos,
    photo_meets_guidelines: photos,
  };
}
