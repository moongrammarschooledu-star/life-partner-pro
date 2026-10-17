// The WhatsApp message written for ONE side of a proposal when the comparison sheet is sent. It opens in the admin's own WhatsApp with the text ready (see whatsapp-link.ts);
// the PDF is attached by the admin. It carries only the person's own first name and the overall match percentage, never the other person's details.

const FALLBACK_NAME = "";

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? FALLBACK_NAME).trim().split(/\s+/)[0] ?? FALLBACK_NAME;
}

export function comparisonShareMessage(input: { fullName: string; matchPercent: number | null }): string {
  const name = firstName(input.fullName);
  const match = input.matchPercent != null ? ` (${Math.round(input.matchPercent)}% match)` : "";
  return `Assalam-o-Alaikum${name ? ` ${name}` : ""}, this is Life Partner Pro. We have a rishta suggestion for you${match}. I am sending the comparison sheet with the details of both sides. Please look at it with your family and let us know what you think. JazakAllah.`;
}
