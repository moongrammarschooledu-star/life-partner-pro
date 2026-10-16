import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { toDetailDto } from "@/lib/serializers";
import { formatEnumLabel } from "@/lib/utils";

// A printable profile sheet for a VERIFIED profile: company logo, photo, and the profile's features, ready to print or hand over. What goes on it:
//   - never the mobile number, WhatsApp number or e-mail address (contact details stay behind the audited reveal), never admin notes, documents or risk information;
//   - income, family, religion and sect only when the person downloading may see them (toDetailDto has already removed what they may not, and this file only prints what is left);
//   - the photo only if there is one (decrypted on the server, never a link).
// pdf-lib's built-in fonts only know Western characters, so anything else (for example Urdu script in a name) is replaced by "?" rather than failing the whole file.

export type ProfileDetailView = ReturnType<typeof toDetailDto>;

export interface PdfSection {
  title: string;
  rows: Array<[label: string, value: string]>;
}

export interface ProfilePdfInput {
  appName: string;
  tagline: string;
  generatedAt: Date;
  profileCode: string;
  fullName: string;
  headline: string;
  verified: boolean;
  sections: PdfSection[];
  logoPng?: Uint8Array | null;
  photo?: { bytes: Uint8Array; kind: "jpg" | "png" } | null;
  footer: string;
}

const PAGE_W = 612; // US Letter; prints fine on A4 too
const PAGE_H = 792;
const MARGIN = 40;
const BRAND = rgb(0.478, 0.059, 0.192); // #7a0f31, the site's brand colour
const GREY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.97, 0.93, 0.94);
const LABEL_W = 150;

const present = (v: string | number | null | undefined): v is string | number => v !== null && v !== undefined && String(v).trim() !== "";

function heightText(cm: number | null | undefined): string | null {
  if (!cm) return null;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)}'${inches % 12}" (${cm} cm)`;
}

function list(value: string | null | undefined): string | null {
  return present(value) ? value.split(",").map((s) => s.trim()).filter(Boolean).join(", ") : null;
}

function yesNo(v: boolean | null | undefined): string | null {
  return v === null || v === undefined ? null : v ? "Yes" : "No";
}

// The rows of each section, from what toDetailDto allows the downloading admin to see. Rows without a value are left out, and so are whole empty sections.
export function profileSections(p: ProfileDetailView): PdfSection[] {
  const rows = (entries: Array<[string, string | number | null | undefined]>): Array<[string, string]> =>
    entries.filter((e): e is [string, string | number] => present(e[1])).map(([l, v]) => [l, String(v)]);

  const personal = rows([
    ["Gender", formatEnumLabel(p.gender)],
    ["Age", `${p.age} years`],
    ["Marital status", formatEnumLabel(p.maritalStatus)],
    ["Children", p.hasChildren ? (p.numberOfChildren ? `Yes (${p.numberOfChildren})` : "Yes") : null],
    ["Height", heightText(p.heightCm)],
    ["City / area", [p.city, p.area].filter(present).join(", ")],
    ["Country", p.country],
    ["Nationality", p.nationality],
  ]);

  const education = rows([
    ["Education", p.education?.level],
    ["Degree", p.education?.degree],
    ["Institution", p.education?.institution],
    ["Profession", p.profession?.profession],
    ["Employment", p.profession ? formatEnumLabel(p.profession.employmentType) : null],
    ["Job title", p.profession?.jobTitle],
    ["Company", p.profession?.companyName],
    ["Work location", p.profession?.workLocation],
    ["Business details", p.profession?.businessDetails],
    ["Monthly income", p.profession?.monthlyIncome], // null already when the downloading admin may not see income
    ["Annual income", p.profession?.annualIncome],
  ]);

  const family = rows([
    ["Father's occupation", p.family?.fatherOccupation],
    ["Mother's occupation", p.family?.motherOccupation],
    ["Brothers", p.family ? p.family.numberOfBrothers : null],
    ["Sisters", p.family ? p.family.numberOfSisters : null],
    ["Family type", p.family ? formatEnumLabel(p.family.familyType) : null],
    ["Family status", p.family ? formatEnumLabel(p.family.familyStatus) : null],
    ["Family location", p.family?.familyLocation],
    ["Family background", p.family?.familyBackground],
    ["More about the family", p.family?.additionalInfo],
  ]);

  const lifestyle = rows([
    ["Religion", p.lifestyle?.religion],
    ["Sect", p.lifestyle?.sect],
    ["Religious practice", p.lifestyle?.religiousPractice],
    ["Languages", list(p.lifestyle?.languages)],
    ["Smoking", p.lifestyle ? yesNo(p.lifestyle.smoking) : null],
    ["Drinking", p.lifestyle ? yesNo(p.lifestyle.drinking) : null],
    ["Hobbies", p.lifestyle?.hobbies],
    ["Personality", list(p.lifestyle?.personality)],
    ["About", p.lifestyle?.aboutMe],
  ]);

  const pref = p.preference;
  const range = (a: number | null | undefined, b: number | null | undefined, unit: string) =>
    present(a) && present(b) ? `${a} to ${b} ${unit}` : present(a) ? `from ${a} ${unit}` : present(b) ? `up to ${b} ${unit}` : null;
  const partner = rows([
    ["Age", range(pref?.minAge, pref?.maxAge, "years")],
    ["Country", pref?.preferredCountry],
    ["City", pref?.preferredCity],
    ["Area", pref?.preferredArea],
    ["Location scope", pref?.locationScope],
    ["Minimum education", pref?.minEducation],
    ["Preferred education", pref?.preferredEducation],
    ["Profession", pref?.professionPreference && pref.professionPreference.toUpperCase() !== "ANY" ? pref.professionPreference : null],
    ["Marital status", pref?.maritalStatusPreference && pref.maritalStatusPreference.toUpperCase() !== "ANY" ? list(pref.maritalStatusPreference.split(",").map((s) => formatEnumLabel(s.trim())).join(", ")) : null],
    ["Height", present(pref?.minHeightCm) || present(pref?.maxHeightCm) ? `${heightText(pref?.minHeightCm) ?? "any"} to ${heightText(pref?.maxHeightCm) ?? "any"}` : null],
    ["Family type", pref?.familyTypePreference],
    ["Family background", pref?.familyBackgroundPreference],
    ["Other family requirements", pref?.otherFamilyRequirements],
    ["Other expectations", pref?.additionalExpectations],
  ]);

  return [
    { title: "Personal details", rows: personal },
    { title: "Education and profession", rows: education },
    { title: "Family", rows: family },
    { title: "Lifestyle and religion", rows: lifestyle },
    { title: "Partner requirements", rows: partner },
  ].filter((s) => s.rows.length > 0);
}

/** The text with every character the built-in font cannot draw replaced by "?" (and line breaks kept as breaks). */
function safeText(font: PDFFont, text: string): string {
  const allowed = new Set(font.getCharacterSet());
  return Array.from(text.replace(/\r/g, ""))
    .map((ch) => (ch === "\n" || allowed.has(ch.codePointAt(0) as number) ? ch : "?"))
    .join("");
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // a single word longer than the line is cut
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

export async function buildProfilePdf(input: ProfilePdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.appName} - profile ${input.profileCode}`);
  doc.setProducer(input.appName);
  doc.setCreator(input.appName);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = (s: string, f: PDFFont = font) => safeText(f, s);

  let logo: PDFImage | null = null;
  if (input.logoPng) logo = await doc.embedPng(input.logoPng).catch(() => null);
  let photo: PDFImage | null = null;
  if (input.photo) photo = await (input.photo.kind === "png" ? doc.embedPng(input.photo.bytes) : doc.embedJpg(input.photo.bytes)).catch(() => null);

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // ---- header: logo, name of the platform, profile id and date
  const logoH = 46;
  const logoW = logo ? (logo.width / logo.height) * logoH : 0;
  if (logo) page.drawImage(logo, { x: MARGIN, y: y - logoH, width: logoW, height: logoH });
  const textX = MARGIN + (logo ? logoW + 12 : 0);
  page.drawText(t(input.appName, bold), { x: textX, y: y - 22, size: 20, font: bold, color: BRAND });
  page.drawText(t(input.tagline), { x: textX, y: y - 38, size: 9, font, color: GREY });
  const idText = t(`Profile ID: ${input.profileCode}`, bold);
  page.drawText(idText, { x: PAGE_W - MARGIN - bold.widthOfTextAtSize(idText, 10), y: y - 18, size: 10, font: bold });
  const dateText = t(`Prepared on ${input.generatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`);
  page.drawText(dateText, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(dateText, 8), y: y - 32, size: 8, font, color: GREY });
  y -= logoH + 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.2, color: BRAND });
  y -= 22;

  // ---- name block, with the photo on the right
  const photoW = 100;
  const photoH = 125;
  const nameWidth = PAGE_W - 2 * MARGIN - (photo ? photoW + 16 : 0);
  const blockTop = y;
  for (const line of wrap(bold, t(input.fullName, bold), 20, nameWidth)) {
    page.drawText(line, { x: MARGIN, y: y - 16, size: 20, font: bold });
    y -= 24;
  }
  for (const line of wrap(font, t(input.headline), 11, nameWidth)) {
    page.drawText(line, { x: MARGIN, y: y - 12, size: 11, font, color: GREY });
    y -= 15;
  }
  if (input.verified) {
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 16, width: 112, height: 18, color: rgb(0.88, 0.96, 0.9) });
    page.drawText("VERIFIED PROFILE", { x: MARGIN + 9, y: y - 11, size: 9, font: bold, color: rgb(0.1, 0.45, 0.2) });
    y -= 20;
  }
  if (photo) {
    const scale = Math.min(photoW / photo.width, photoH / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    const px = PAGE_W - MARGIN - photoW + (photoW - w) / 2;
    page.drawRectangle({ x: PAGE_W - MARGIN - photoW - 2, y: blockTop - photoH - 2, width: photoW + 4, height: photoH + 4, borderColor: BRAND, borderWidth: 1 });
    page.drawImage(photo, { x: px, y: blockTop - photoH + (photoH - h) / 2, width: w, height: h });
    y = Math.min(y, blockTop - photoH - 6);
  }
  y -= 14;

  const ensure = (needed: number) => {
    if (y - needed < MARGIN + 30) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // ---- sections
  for (const section of input.sections) {
    ensure(40);
    page.drawRectangle({ x: MARGIN, y: y - 16, width: PAGE_W - 2 * MARGIN, height: 18, color: LIGHT });
    page.drawText(t(section.title, bold), { x: MARGIN + 8, y: y - 11, size: 10.5, font: bold, color: BRAND });
    y -= 26;
    for (const [label, value] of section.rows) {
      const lines = wrap(font, t(value), 10, PAGE_W - 2 * MARGIN - LABEL_W - 8);
      ensure(lines.length * 13 + 4);
      page.drawText(t(label, bold), { x: MARGIN + 8, y: y - 10, size: 9.5, font: bold, color: GREY });
      for (const line of lines) {
        page.drawText(line, { x: MARGIN + LABEL_W, y: y - 10, size: 10, font });
        y -= 13;
      }
      y -= 4;
    }
    y -= 8;
  }

  // ---- footer and page numbers on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 18 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 18 }, thickness: 0.5, color: GREY });
    p.drawText(t(input.footer), { x: MARGIN, y: MARGIN + 6, size: 7.5, font, color: GREY, maxWidth: PAGE_W - 2 * MARGIN - 50 });
    const n = `${i + 1} / ${pages.length}`;
    p.drawText(n, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(n, 8), y: MARGIN + 6, size: 8, font, color: GREY });
  });

  return Buffer.from(await doc.save());
}
